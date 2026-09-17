// [Input] Existing Dream bcrypt/Admin scrypt hashes and a password supplied to Better Auth.
// [Output] Compatible password hash/verification under the single Admin authority.
// [Pos] Better Auth credential adapter; preserves existing login product behavior.
// [Sync] 2026-09-14: retain bcrypt hashes and original minimum length instead of removing password sign-in.
import { compare, hash } from "bcryptjs";
import { verifyAdminPassword } from "../admin/password";
import { AuthBoundaryError } from "./config";

export const productPasswordMinimumLength = 6;
export async function hashUnifiedPassword(password: string) {
  const cost = Number(process.env.AUTH_BCRYPT_COST ?? 12);
  if (!Number.isSafeInteger(cost) || cost < 4 || cost > 31) throw new AuthBoundaryError("AUTH_PASSWORD_POLICY_INVALID");
  if (Buffer.byteLength(password, "utf8") > 72) throw new AuthBoundaryError("PASSWORD_ENCODING_TOO_LONG", 400);
  return hash(password, cost);
}
export async function verifyUnifiedPassword({ hash: encoded, password }: { hash: string; password: string }) {
  if (/^\$2[aby]\$/.test(encoded)) { try { return await compare(password, encoded); } catch { return false; } }
  if (encoded.startsWith("scrypt$")) return verifyAdminPassword(password, encoded);
  return false;
}
