import assert from "node:assert/strict";
import { sendSms } from "../services/churchMemberSms.service.js";

const originalApiKey = process.env.TEXTBEE_API_KEY;
const originalBaseUrl = process.env.TEXTBEE_BASE_URL;
const originalFetch = globalThis.fetch;

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
        return { data: { smsBatchId: "batch-123", recipientCount: 1 } };
      },
    };
  };

  const defaultResult = await sendSms(["+234 816 160 8839"], "Hello from TextBee");
  assert.equal(requestUrl, "https://api.textbee.dev/api/v1/gateway/send-sms");
  assert.deepEqual(defaultResult, { smsBatchId: "batch-123", recipientCount: 1 });

  process.env.TEXTBEE_BASE_URL = "https://textbee.example/api/v1/";
  const result = await sendSms(["+234 816 160 8839"], "Hello from TextBee");

  assert.equal(requestUrl, "https://textbee.example/api/v1/gateway/send-sms");
  assert.equal(requestOptions.method, "POST");
  assert.equal(requestOptions.headers["x-api-key"], "test-api-key");
  assert.equal(requestOptions.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(requestOptions.body), {
    recipients: ["+234 816 160 8839"],
    message: "Hello from TextBee",
  });
  assert.deepEqual(result, { smsBatchId: "batch-123", recipientCount: 1 });

  globalThis.fetch = async () => ({ ok: false, status: 401 });
  await assert.rejects(sendSms(["+234 816 160 8839"], "Hello"), /TextBee returned HTTP 401/);
} finally {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.TEXTBEE_API_KEY;
  else process.env.TEXTBEE_API_KEY = originalApiKey;
  if (originalBaseUrl === undefined) delete process.env.TEXTBEE_BASE_URL;
  else process.env.TEXTBEE_BASE_URL = originalBaseUrl;
}

console.log("church-member TextBee SMS tests passed");
