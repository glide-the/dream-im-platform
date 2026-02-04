/**
 * Utility functions migrated from better-chatbot
 */

/**
 * Generate a random UUID v4 style string
 */
export function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Wait for a specified number of milliseconds
 */
export const wait = (delay = 0) =>
  new Promise<void>((resolve) => setTimeout(resolve, delay));

/**
 * No-operation function
 */
export const noop = () => {};

/**
 * Check if a value is a string
 */
export const isString = (value: unknown): value is string =>
  typeof value === "string";

/**
 * Check if a value is a function
 */
export const isFunction = <
  T extends (...args: unknown[]) => unknown = (...args: unknown[]) => unknown,
>(
  v: unknown,
): v is T => typeof v === "function";

/**
 * Check if a value is an object
 */
export const isObject = (value: unknown): value is Record<string, unknown> =>
  Object(value) === value;

/**
 * Check if a value is null or undefined
 */
export const isNull = (value: unknown): value is null | undefined => value == null;

/**
 * Check if a value looks like a Promise
 */
export const isPromiseLike = (x: unknown): x is PromiseLike<unknown> =>
  isFunction((x as { then?: unknown })?.then);

/**
 * Wrap a promise with a timeout
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timeout"));
    }, ms);
    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Convert an error to a string message
 */
export function errorToString(error: unknown): string {
  if (error == null) {
    return "unknown error";
  }

  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return JSON.stringify(error);
}

/**
 * Safely parse JSON
 */
export function safeJSONParse<T = unknown>(
  json: string,
):
  | {
      success: true;
      value: T;
      error?: unknown;
    }
  | {
      success: false;
      error: unknown;
      value?: T;
    } {
  try {
    const parsed = JSON.parse(json);
    return {
      success: true,
      value: parsed,
    };
  } catch (e) {
    return {
      success: false,
      error: e,
    };
  }
}

/**
 * Group array items by a key
 */
export const groupBy = <T>(arr: T[], getter: keyof T | ((item: T) => string)) =>
  arr.reduce(
    (prev, item) => {
      const key: string =
        getter instanceof Function ? getter(item) : (item[getter] as string);

      if (!prev[key]) prev[key] = [];
      prev[key].push(item);
      return prev;
    },
    {} as Record<string, T[]>,
  );

/**
 * Parse environment boolean values
 */
export function parseEnvBoolean(value: string | boolean | undefined): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowerVal = value.toLowerCase();
    return lowerVal === "true" || lowerVal === "1" || lowerVal === "y";
  }
  return false;
}

/**
 * Create a deferred promise
 */
export const Deferred = <T = void>() => {
  let resolve!: T extends void ? (value?: unknown) => void : (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((rs, rj) => {
    resolve = rs as T extends void ? (value?: unknown) => void : (value: T) => void;
    reject = rj;
  });

  return {
    promise,
    reject,
    resolve,
  };
};

/**
 * Capitalize the first letter of a string
 */
export function capitalizeFirstLetter(str: string): string {
  if (!str || str.length === 0) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Truncate a string to a maximum length
 */
export function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + "...";
}

/**
 * Wait for next tick
 */
export async function nextTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
