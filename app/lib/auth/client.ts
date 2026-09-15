// [Input] Same-origin Admin auth routes and installed Better Auth OAuth/device client plugins.
// [Output] Browser session/social/password client carrying the provider's signed OAuth query.
// [Pos] Authentication UI client; no server secrets, access or refresh token storage.
// [Sync] 2026-09-14: use official 1.7.4 clients with the installed protocol composition.
"use client";
import { createAuthClient } from "better-auth/react";
import { oauthProviderClient, oauthDeviceAuthorizationClient } from "@better-auth/oauth-provider/client";
export const adminAuthClient = createAuthClient({ plugins: [oauthProviderClient(), oauthDeviceAuthorizationClient()] });
