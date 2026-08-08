import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
const KEY_LENGTH = 64;
const N = 16_384;
const R = 8;
const P = 1;
const MAX_MEMORY = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      KEY_LENGTH,
      { N, r: R, p: P, maxmem: MAX_MEMORY },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

export function validateAdminPassword(password: string) {
  if (password.length < 14 || password.length > 256) {
    throw new RangeError("Admin passwords must contain 14-256 characters");
  }
}

export async function hashAdminPassword(password: string) {
  validateAdminPassword(password);
  const salt = randomBytes(16);
  const derived = await derive(password, salt);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyAdminPassword(password: string, encoded: string) {
  const [algorithm, n, r, p, salt, expected] = encoded.split("$");
  if (
    algorithm !== "scrypt" ||
    Number(n) !== N ||
    Number(r) !== R ||
    Number(p) !== P ||
    !salt ||
    !expected
  ) {
    return false;
  }
  try {
    const expectedBuffer = Buffer.from(expected, "base64");
    if (expectedBuffer.length !== KEY_LENGTH) return false;
    const actual = await derive(password, Buffer.from(salt, "base64"));
    return timingSafeEqual(actual, expectedBuffer);
  } catch {
    return false;
  }
}
