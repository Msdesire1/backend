import assert from "node:assert/strict";
import { sendSms } from "../services/churchMemberSms.service.js";

const originalApiKey = process.env.TEXTBEE_API_KEY;
const originalBaseUrl = process.env.TEXTBEE_BASE_URL;
const originalFetch = globalThis.fetch;
const originalConsoleInfo = console.info;
const originalConsoleError = console.error;
const logs = [];
console.info = (...args) => logs.push(args.join(" "));
console.error = (...args) => logs.push(args.join(" "));

try {
  delete process.env.TEXTBEE_API_KEY;
  await assert.rejects(sendSms(["‎+234 816 160 8839"], "Hello"), /TEXTBEE_API_KEY is not configured/);

  process.env.TEXTBEE_API_KEY = "test-api-key";
  delete process.env.TEXTBEE_BASE_URL;

  let requestUrl;
  let requestOptions;
  globalThis.fetch = async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return {
      ok: true,
      async json() {
        return { success: true, smsBatchId: "batch-123", recipientCount: 1 };
      },
    };
  };

  const defaultResult = await sendSms(["‎+234 816 160 8839"], "Hello from TextBee");
  assert.equal(requestUrl, "https://api.textbee.dev/api/v1/gateway/send-sms");
  assert.deepEqual(JSON.parse(requestOptions.body).recipients, ["+2348161608839"]);
  assert.deepEqual(defaultResult, { success: true, smsBatchId: "batch-123", recipientCount: 1 });

  process.env.TEXTBEE_BASE_URL = "https://textbee.example/api/v1/";
  const result = await sendSms(["0801 234 5678"], "Hello from TextBee");

  assert.equal(requestUrl, "https://textbee.example/api/v1/gateway/send-sms");
  assert.equal(requestOptions.method, "POST");
  assert.equal(requestOptions.headers["x-api-key"], "test-api-key");
  assert.equal(requestOptions.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(requestOptions.body), {
    recipients: ["+2348012345678"],
    message: "Hello from TextBee",
    deviceId: "6ae4875359a24e053f738ea2",
    simSubscriptionId: 1,
  });
  assert.deepEqual(result, { success: true, smsBatchId: "batch-123", recipientCount: 1 });

  await sendSms(["234 816 160 8839"], "Hello");
  assert.deepEqual(JSON.parse(requestOptions.body).recipients, ["+2348161608839"]);
  await assert.rejects(sendSms(["not a phone"], "Hello"), /must use E\.164 format/);

  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    async json() {
      return { message: "API key is invalid." };
    },
  });
  await assert.rejects(sendSms(["+2348161608839"], "Hello"), /TextBee returned HTTP 401: API key is invalid/);

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { success: false, message: "No enabled device." };
    },
  });
  await assert.rejects(sendSms(["+2348161608839"], "Hello"), /No enabled device/);

  assert.ok(logs.some((entry) => entry.includes('"smsBatchId":"batch-123"')));
  assert.ok(logs.some((entry) => entry.includes("API key is invalid.")));
  assert.ok(logs.every((entry) => !entry.includes("test-api-key")));
  assert.ok(logs.every((entry) => !entry.includes("+2348161608839")));
  assert.ok(logs.every((entry) => !entry.includes("Hello from TextBee")));
} finally {
  globalThis.fetch = originalFetch;
  console.info = originalConsoleInfo;
  console.error = originalConsoleError;
  if (originalApiKey === undefined) delete process.env.TEXTBEE_API_KEY;
  else process.env.TEXTBEE_API_KEY = originalApiKey;
  if (originalBaseUrl === undefined) delete process.env.TEXTBEE_BASE_URL;
  else process.env.TEXTBEE_BASE_URL = originalBaseUrl;
}

console.log("church-member TextBee SMS tests passed");
