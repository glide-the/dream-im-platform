// [Input] Strict browser-session domain values and an existing identity ORM transaction.
// [Output] Client/origin-bound encrypted session persistence and exact transaction recovery.
// [Pos] Typed browser-handle repository; entity rows never pass the public boundary.
// [Sync] 2026-09-14: isolate handle/token persistence from OAuth client request DTOs.
import { and, eq } from "drizzle-orm";
import { browserSessions } from "@ink-memory/db/schema/auth";
import type { AuthTransaction } from "./database";
import type { DreamServiceClient } from "./config";

export class BrowserSessionRepository {
  constructor(private readonly tx: AuthTransaction, private readonly service: DreamServiceClient) {}
  async findTransaction(transactionId: string) {
    const rows = await this.tx.select().from(browserSessions).where(and(eq(browserSessions.serviceClientId, this.service.id), eq(browserSessions.origin, this.service.origin), eq(browserSessions.transactionId, transactionId))).limit(1);
    return rows[0] ?? null;
  }
  async lockHandle(handleHash: string) {
    const rows = await this.tx.select().from(browserSessions).where(and(eq(browserSessions.handleHash, handleHash), eq(browserSessions.serviceClientId, this.service.id), eq(browserSessions.origin, this.service.origin))).for("update").limit(1);
    return rows[0] ?? null;
  }
  async create(input: { handleHash: string; authUserId: string; transactionId: string; inputSha256: string; tokenCiphertext: string; expiresAt: Date }) {
    await this.tx.insert(browserSessions).values({ ...input, serviceClientId: this.service.id, origin: this.service.origin });
  }
  async updateTokens(handleHash: string, tokenCiphertext: string) {
    await this.tx.update(browserSessions).set({ tokenCiphertext, updatedAt: new Date() }).where(and(eq(browserSessions.handleHash, handleHash), eq(browserSessions.serviceClientId, this.service.id), eq(browserSessions.origin, this.service.origin)));
  }
  async setStatus(handleHash: string, status: "login_required" | "revoked") {
    await this.tx.update(browserSessions).set({ status, updatedAt: new Date(), ...(status === "revoked" ? { revokedAt: new Date() } : {}) }).where(and(eq(browserSessions.handleHash, handleHash), eq(browserSessions.serviceClientId, this.service.id), eq(browserSessions.origin, this.service.origin)));
  }
}
