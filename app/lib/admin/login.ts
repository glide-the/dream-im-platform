import { withPlatformClient, withPlatformTransaction } from "../platform-db";
import { recordAdminAuditOnClient } from "./audit";
import { AdminError } from "./errors";
import { hashAdminPassword, verifyAdminPassword } from "./password";

let dummyHash: Promise<string> | undefined;

function getDummyHash() {
  dummyHash ??= hashAdminPassword("invalid admin password placeholder");
  return dummyHash;
}

export async function verifyAdminLogin(input: {
  email: string;
  password: string;
  request: Request;
  requestId: string;
}) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const user = await withPlatformClient(async (client) => {
    const { rows } = await client.query<{
      id: string;
      email: string;
      display_name: string | null;
      password_hash: string;
      status: string;
    }>(
      `SELECT id, email, display_name, password_hash, status
       FROM admin_users
       WHERE lower(email) = $1
       LIMIT 1`,
      [normalizedEmail],
    );
    return rows[0] ?? null;
  });
  const passwordHash = user?.password_hash ?? (await getDummyHash());
  const valid = await verifyAdminPassword(input.password, passwordHash);
  if (!user || !valid || user.status !== "active") {
    throw new AdminError(
      "ADMIN_CREDENTIALS_INVALID",
      "The email or password is invalid",
      401,
    );
  }

  await withPlatformTransaction(async (client) => {
    await client.query(
      `UPDATE admin_users
       SET last_login_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [user.id],
    );
    await recordAdminAuditOnClient(client, {
      action: "login",
      resourceType: "admin_session",
      resourceId: user.id,
      requestId: input.requestId,
      request: input.request,
      after: { authenticated: true },
    });
  });
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name ?? undefined,
  };
}
