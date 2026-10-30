import ChurchMember from "../models/churchMember.model.js";
import ChurchMemberMessage from "../models/churchMemberMessage.model.js";

const RUN_INTERVAL_MS = 15 * 60 * 1000;
const CLAIM_LEASE_MS = 10 * 60 * 1000;

const logTextBeeResponse = (status, payload) => {
  const details = {
    httpStatus: status,
    success: payload?.success,
    message: payload?.message,
    error: payload?.error,
    errorCode: payload?.errorCode,
    smsBatchId: payload?.smsBatchId,
    recipientCount: payload?.recipientCount,
    estimatedCompletionAt: payload?.estimatedCompletionAt,
  };
  for (const key of Object.keys(details)) {
    if (details[key] === undefined) delete details[key];
  }

  const log = status >= 400 || payload?.success !== true ? console.error : console.info;
  log(`[TextBee] SMS request response: ${JSON.stringify(details)}`);
};

const normalizeTextBeePhone = (value) => {
  if (typeof value !== "string") {
    throw new Error("TextBee recipients must be phone number strings in E.164 format.");
  }

  let phone = value.trim().replace(/\p{Cf}/gu, "").replace(/[\s().-]/g, "");
  if (/^0\d+$/.test(phone)) phone = `+234${phone.slice(1)}`;
  else if (/^234\d+$/.test(phone)) phone = `+${phone}`;

  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    throw new Error("TextBee recipients must use E.164 format, such as +2348012345678.");
  }
  return phone;
};

export const sendSms = async (recipients, message) => {
  const apiKey = process.env.TEXTBEE_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error("TEXTBEE_API_KEY is not configured.");
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error("TextBee requires at least one recipient.");
  }
  if (typeof message !== "string" || !message.trim()) {
    throw new Error("TextBee requires a non-empty message.");
  }

  const baseURL = (process.env.TEXTBEE_BASE_URL ?? "https://api.textbee.dev/api/v1").replace(/\/+$/, "");
  const response = await fetch(`${baseURL}/gateway/send-sms`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recipients: recipients.map(normalizeTextBeePhone),
      message,
      deviceId: "6ae4875359a24e053f738ea2",
      simSubscriptionId: 1,
    }),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    if (!response.ok) {
      logTextBeeResponse(response.status);
      throw new Error(`TextBee returned HTTP ${response.status}.`);
    }
    logTextBeeResponse(response.status);
    throw new Error("TextBee returned an invalid JSON response.");
  }
  logTextBeeResponse(response.status, payload);
  if (!response.ok) {
    const reason = payload?.message || payload?.error;
    throw new Error(`TextBee returned HTTP ${response.status}${reason ? `: ${reason}` : "."}`);
  }
  if (payload?.success !== true) {
    throw new Error(payload?.message || payload?.error || "TextBee did not accept the SMS batch.");
  }
  return payload;
};

const churchDateParts = (date = new Date()) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: process.env.CHURCH_TIME_ZONE || "Africa/Lagos",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );

const claimMessage = async (memberId, event, year) => {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + CLAIM_LEASE_MS);
  try {
    await ChurchMemberMessage.create({
      member: memberId,
      event,
      year,
      status: "processing",
      leaseUntil,
    });
    return true;
  } catch (error) {
    if (error.code !== 11000) throw error;
  }

  const claimed = await ChurchMemberMessage.findOneAndUpdate(
    {
      member: memberId,
      event,
      year,
      $or: [{ status: "failed" }, { status: "processing", leaseUntil: { $lte: now } }],
    },
    {
      $set: { status: "processing", leaseUntil, error: "", sentAt: null },
    },
    { new: true },
  );
  return Boolean(claimed);
};

const deliverEvent = async (member, event, year) => {
  if (!(await claimMessage(member._id, event, year))) return;
  const message =
    event === "birthday"
      ? `Happy birthday, ${member.fullName}! Living Faith Church New Jerusalem celebrates, May this new year bring you greater blessings, joy and fulfilment. We celebrate you today and wish you a fantastic year ahead!`
      : `Happy Wedding Anniversary to Mr and Mrs ${member.fullName}! May your home continue to experience love, peace and God's abundant blessings. Congratulations! from Living Faith Church New Jerusalem.`;

  try {
    await sendSms([member.phone], message);
    await ChurchMemberMessage.updateOne(
      { member: member._id, event, year, status: "processing" },
      { $set: { status: "sent", sentAt: new Date(), error: "" } },
    );
  } catch (error) {
    await ChurchMemberMessage.updateOne(
      { member: member._id, event, year, status: "processing" },
      { $set: { status: "failed", error: error.message.slice(0, 300) } },
    );
    console.error(`Church ${event} SMS failed for member ${member._id}: ${error.message}`);
  }
};

export const sendTodaysChurchMessages = async (date = new Date()) => {
  if (!process.env.TEXTBEE_API_KEY) {
    throw new Error("TEXTBEE_API_KEY is not configured.");
  }
  const { year, month, day } = churchDateParts(date);
  const [birthdays, anniversaries] = await Promise.all([
    ChurchMember.find({
      birthdayAnniversarySmsConsent: true,
      $expr: {
        $and: [
          { $eq: [{ $month: "$dateOfBirth" }, month] },
          { $eq: [{ $dayOfMonth: "$dateOfBirth" }, day] },
        ],
      },
    }).select("_id fullName phone"),
    ChurchMember.find({
      birthdayAnniversarySmsConsent: true,
      maritalStatus: "Married",
      weddingAnniversary: { $ne: null },
      $expr: {
        $and: [
          { $eq: [{ $month: "$weddingAnniversary" }, month] },
          { $eq: [{ $dayOfMonth: "$weddingAnniversary" }, day] },
        ],
      },
    }).select("_id fullName phone"),
  ]);

  await Promise.all([
    ...birthdays.map((member) => deliverEvent(member, "birthday", year)),
    ...anniversaries.map((member) => deliverEvent(member, "anniversary", year)),
  ]);
};

export const startChurchSmsScheduler = () => {
  if (!process.env.TEXTBEE_API_KEY) {
    console.warn("Birthday and anniversary SMS are disabled: TEXTBEE_API_KEY is not configured.");
    return () => {};
  }

  const run = () => {
    sendTodaysChurchMessages().catch((error) => {
      console.error(`Church birthday/anniversary SMS scheduler failed: ${error.message}`);
    });
  };
  run();
  const interval = setInterval(run, RUN_INTERVAL_MS);
  return () => clearInterval(interval);
};
