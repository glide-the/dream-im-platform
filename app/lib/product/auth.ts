// [Input] Admin ES256 OAuth access grant and existing Product read UOW/permissions.
// [Output] Explicit canonical identity mapping and active Product principal.
// [Pos] Product resource authorization; Admin is the only token authority.
// [Sync] 2026-09-14: retire Dream HS256 verification; preserve catalog/entitlement read semantics.
import type { PoolClient } from "pg";
import { ProductError } from "./errors";
import { findProductIdentityOnClient, type ProductIdentityRow } from "./repository";
import { assertNoProductUserOverride } from "./request";
import type { ProductPrincipal } from "./types";
import { withProductReadUnitOfWork, type ProductReadUnitOfWork } from "./uow";
import { verifyAdminAccessToken } from "../auth/accessToken";
import { withAuthTransaction } from "../auth/database";
import { SubjectRepository } from "../auth/subjectRepository";
import { AuthBoundaryError } from "../auth/config";
export type VerifiedProductToken = { canonicalUserId: string; clientId: string; tokenId: string; scopes: string[] };
export async function verifyProductJwt(headers: Headers, requiredScope: "product:read" | "product:write"): Promise<VerifiedProductToken> {
  try {
    const verified = await verifyAdminAccessToken(headers, requiredScope);
    const identity = await withAuthTransaction(tx => new SubjectRepository(tx).findActive(verified.subject));
    if (!identity) throw new ProductError("CANONICAL_USER_REQUIRED", "An active linked canonical user is required", 403);
    return { canonicalUserId: identity.canonicalUserId.toString(), clientId: verified.clientId, tokenId: verified.tokenId, scopes: verified.scopes };
  } catch (error) {
    if (error instanceof ProductError) throw error;
    const status = error instanceof AuthBoundaryError ? error.status : 503;
    throw new ProductError(status === 403 ? "PRODUCT_SCOPE_REQUIRED" : status === 401 ? "PRODUCT_AUTH_REQUIRED" : "PRODUCT_AUTH_NOT_CONFIGURED", "Product authentication could not be completed", status);
  }
}

type ProductAuthDependencies = {
  verifyToken?: typeof verifyProductJwt;
  readUnitOfWork?: ProductReadUnitOfWork;
  findIdentity?: (
    client: PoolClient,
    canonicalUserId: string,
  ) => Promise<ProductIdentityRow | null>;
};

export async function requireProductPrincipal(
  request: Request,
  requiredScope: "product:read" | "product:write",
  dependencies: ProductAuthDependencies = {},
): Promise<ProductPrincipal> {
  assertNoProductUserOverride(request);
  const verified = await (dependencies.verifyToken ?? verifyProductJwt)(
    request.headers,
    requiredScope,
  );
  const identity = await (
    dependencies.readUnitOfWork ?? withProductReadUnitOfWork
  )(async (client) =>
    await (dependencies.findIdentity ?? findProductIdentityOnClient)(
      client,
      verified.canonicalUserId,
    ),
  );
  if (!identity?.canonical_user_id) {
    throw new ProductError(
      "CANONICAL_USER_REQUIRED",
      "The authenticated subject is not an active canonical user",
      403,
    );
  }
  if (
    !identity.platform_user_id ||
    identity.platform_status !== "active" ||
    !identity.tier
  ) {
    throw new ProductError(
      "CANONICAL_USER_REQUIRED",
      "The authenticated canonical user has no active platform projection",
      403,
    );
  }
  return {
    ...verified,
    platformUserId: identity.platform_user_id,
    tier: identity.tier,
  };
}
