import assert from "node:assert/strict";
import test from "node:test";
import { api, ApiError, errorMessage, loginErrorMessage } from "./api.ts";

test("login 401 reports a generic invalid-credentials message", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ detail: "Invalid email or password" }),
    { status: 401, headers: { "Content-Type": "application/json" } },
  );

  try {
    await assert.rejects(api.login("unknown@example.com", "wrong-password"), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 401);
      assert.equal(loginErrorMessage(error), "Invalid email or password.");
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("protected-request 401 retains the expired-session behavior", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  let storedToken = "test-session-token";
  const events = [];
  globalThis.window = {
    sessionStorage: {
      getItem: () => storedToken,
      removeItem: () => { storedToken = null; },
    },
    dispatchEvent: (event) => events.push(event.type),
  };
  globalThis.fetch = async () => new Response(
    JSON.stringify({ detail: "Invalid or expired access token" }),
    { status: 401, headers: { "Content-Type": "application/json" } },
  );

  try {
    await assert.rejects(api.me(), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 401);
      assert.equal(errorMessage(error), "Your session is missing or expired. Sign in again.");
      assert.equal(storedToken, null);
      assert.deepEqual(events, ["apaar:unauthorized"]);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test("non-401 API errors retain their existing messages", () => {
  const error = new ApiError(403, "Insufficient role");

  assert.equal(loginErrorMessage(error), "Your account does not have permission for this action.");
  assert.equal(loginErrorMessage(new ApiError(503, "Database is unavailable")), "Database is unavailable");
});
