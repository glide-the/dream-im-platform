import { describe, expect, it } from "vitest";
import {
  generateUUID,
  wait,
  noop,
  isString,
  isFunction,
  isObject,
  isNull,
  isPromiseLike,
  withTimeout,
  errorToString,
  safeJSONParse,
  groupBy,
  parseEnvBoolean,
  capitalizeFirstLetter,
  truncateString,
} from "./utils";

describe("generateUUID", () => {
  it("generates a valid UUID-like string", () => {
    const uuid = generateUUID();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("generates unique UUIDs", () => {
    const uuid1 = generateUUID();
    const uuid2 = generateUUID();
    expect(uuid1).not.toBe(uuid2);
  });
});

describe("wait", () => {
  it("resolves after the specified delay", async () => {
    const start = Date.now();
    await wait(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  it("resolves immediately with 0 delay", async () => {
    const start = Date.now();
    await wait(0);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(20);
  });
});

describe("noop", () => {
  it("is a function that does nothing", () => {
    expect(typeof noop).toBe("function");
    expect(noop()).toBeUndefined();
  });
});

describe("isString", () => {
  it("returns true for strings", () => {
    expect(isString("hello")).toBe(true);
    expect(isString("")).toBe(true);
  });

  it("returns false for non-strings", () => {
    expect(isString(123)).toBe(false);
    expect(isString(null)).toBe(false);
    expect(isString(undefined)).toBe(false);
    expect(isString({})).toBe(false);
  });
});

describe("isFunction", () => {
  it("returns true for functions", () => {
    expect(isFunction(() => {})).toBe(true);
    expect(isFunction(function() {})).toBe(true);
  });

  it("returns false for non-functions", () => {
    expect(isFunction("hello")).toBe(false);
    expect(isFunction(123)).toBe(false);
    expect(isFunction(null)).toBe(false);
  });
});

describe("isObject", () => {
  it("returns true for objects", () => {
    expect(isObject({})).toBe(true);
    expect(isObject({ a: 1 })).toBe(true);
    expect(isObject([])).toBe(true);
  });

  it("returns false for primitives", () => {
    expect(isObject("hello")).toBe(false);
    expect(isObject(123)).toBe(false);
    expect(isObject(null)).toBe(false);
  });
});

describe("isNull", () => {
  it("returns true for null and undefined", () => {
    expect(isNull(null)).toBe(true);
    expect(isNull(undefined)).toBe(true);
  });

  it("returns false for other values", () => {
    expect(isNull("")).toBe(false);
    expect(isNull(0)).toBe(false);
    expect(isNull(false)).toBe(false);
  });
});

describe("isPromiseLike", () => {
  it("returns true for promises", () => {
    expect(isPromiseLike(Promise.resolve())).toBe(true);
    expect(isPromiseLike({ then: () => {} })).toBe(true);
  });

  it("returns false for non-promises", () => {
    expect(isPromiseLike({})).toBe(false);
    expect(isPromiseLike("hello")).toBe(false);
    expect(isPromiseLike(null)).toBe(false);
  });
});

describe("withTimeout", () => {
  it("resolves when promise completes before timeout", async () => {
    const result = await withTimeout(Promise.resolve("ok"), 1000);
    expect(result).toBe("ok");
  });

  it("rejects with timeout error when promise takes too long", async () => {
    const slowPromise = new Promise((resolve) => setTimeout(resolve, 200));
    await expect(withTimeout(slowPromise, 50)).rejects.toThrow("Timeout");
  });

  it("rejects with original error when promise fails", async () => {
    const errorPromise = Promise.reject(new Error("original"));
    await expect(withTimeout(errorPromise, 1000)).rejects.toThrow("original");
  });
});

describe("errorToString", () => {
  it("returns 'unknown error' for null/undefined", () => {
    expect(errorToString(null)).toBe("unknown error");
    expect(errorToString(undefined)).toBe("unknown error");
  });

  it("returns string errors as-is", () => {
    expect(errorToString("something went wrong")).toBe("something went wrong");
  });

  it("returns error message from Error objects", () => {
    expect(errorToString(new Error("test error"))).toBe("test error");
  });

  it("JSON stringifies other values", () => {
    expect(errorToString({ code: 123 })).toBe('{"code":123}');
  });
});

describe("safeJSONParse", () => {
  it("parses valid JSON", () => {
    const result = safeJSONParse('{"key":"value"}');
    expect(result.success).toBe(true);
    expect(result.value).toEqual({ key: "value" });
  });

  it("returns error for invalid JSON", () => {
    const result = safeJSONParse("not json");
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe("groupBy", () => {
  it("groups by key", () => {
    const items = [
      { type: "a", value: 1 },
      { type: "b", value: 2 },
      { type: "a", value: 3 },
    ];
    const result = groupBy(items, "type");
    expect(result.a).toHaveLength(2);
    expect(result.b).toHaveLength(1);
  });

  it("groups by function", () => {
    const items = [1, 2, 3, 4, 5];
    const result = groupBy(items, (n) => (n % 2 === 0 ? "even" : "odd"));
    expect(result.even).toEqual([2, 4]);
    expect(result.odd).toEqual([1, 3, 5]);
  });
});

describe("parseEnvBoolean", () => {
  it("returns true for truthy string values", () => {
    expect(parseEnvBoolean("true")).toBe(true);
    expect(parseEnvBoolean("1")).toBe(true);
    expect(parseEnvBoolean("y")).toBe(true);
    expect(parseEnvBoolean("TRUE")).toBe(true);
  });

  it("returns false for falsy string values", () => {
    expect(parseEnvBoolean("false")).toBe(false);
    expect(parseEnvBoolean("0")).toBe(false);
    expect(parseEnvBoolean("")).toBe(false);
  });

  it("returns boolean as-is", () => {
    expect(parseEnvBoolean(true)).toBe(true);
    expect(parseEnvBoolean(false)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(parseEnvBoolean(undefined)).toBe(false);
  });
});

describe("capitalizeFirstLetter", () => {
  it("capitalizes first letter", () => {
    expect(capitalizeFirstLetter("hello")).toBe("Hello");
    expect(capitalizeFirstLetter("world")).toBe("World");
  });

  it("handles empty strings", () => {
    expect(capitalizeFirstLetter("")).toBe("");
  });

  it("handles already capitalized strings", () => {
    expect(capitalizeFirstLetter("Hello")).toBe("Hello");
  });
});

describe("truncateString", () => {
  it("truncates long strings", () => {
    expect(truncateString("hello world", 5)).toBe("hello...");
  });

  it("returns short strings unchanged", () => {
    expect(truncateString("hi", 10)).toBe("hi");
  });

  it("handles exact length", () => {
    expect(truncateString("hello", 5)).toBe("hello");
  });
});
