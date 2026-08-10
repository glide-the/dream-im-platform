import { describe, expect, it } from "vitest";

import { modelRequestHeadersSchema } from "./request-headers";

describe("model request header configuration", () => {
  it("normalizes valid model-specific headers", () => {
    expect(modelRequestHeadersSchema.parse({
      "User-Agent": "OpenAI/JS 6.39.1",
      "X-Client-Channel": "openclaw",
    })).toEqual({
      "user-agent": "OpenAI/JS 6.39.1",
      "x-client-channel": "openclaw",
    });
  });

  it.each(["Authorization", "x-api-key", "x-client-token", "Host", "Content-Length", "Content-Type", "X-Forwarded-For"])(
    "rejects the gateway-managed header %s",
    (name) => {
      expect(modelRequestHeadersSchema.safeParse({ [name]: "unsafe" }).success).toBe(false);
    },
  );

  it("rejects non-string values and header injection", () => {
    expect(modelRequestHeadersSchema.safeParse({ "x-retry": 3 }).success).toBe(false);
    expect(modelRequestHeadersSchema.safeParse({ "x-client": "safe\r\ninjected: true" }).success).toBe(false);
  });

  it("rejects duplicate header names with different casing", () => {
    expect(modelRequestHeadersSchema.safeParse({
      "User-Agent": "first",
      "user-agent": "second",
    }).success).toBe(false);
  });
});
