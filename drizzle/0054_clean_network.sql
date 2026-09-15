CREATE SCHEMA "identity";
--> statement-breakpoint
CREATE SCHEMA "dream";
--> statement-breakpoint
CREATE TABLE "identity"."account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."deviceCode" (
	"id" text PRIMARY KEY NOT NULL,
	"deviceCode" text NOT NULL,
	"userCode" text NOT NULL,
	"userId" text,
	"expiresAt" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"lastPolledAt" timestamp with time zone,
	"pollingInterval" integer,
	"clientId" text,
	"scope" text,
	"resources" text[],
	"oauthClientId" text
);
--> statement-breakpoint
CREATE TABLE "identity"."jwks" (
	"id" text PRIMARY KEY NOT NULL,
	"publicKey" text NOT NULL,
	"privateKey" text NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"expiresAt" timestamp with time zone,
	"alg" text,
	"crv" text
);
--> statement-breakpoint
CREATE TABLE "identity"."oauthAccessToken" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text,
	"clientId" text NOT NULL,
	"sessionId" text,
	"userId" text,
	"referenceId" text,
	"authorizationCodeId" text,
	"resources" text[],
	"requestedUserInfoClaims" text[],
	"refreshId" text,
	"expiresAt" timestamp with time zone,
	"createdAt" timestamp with time zone,
	"revoked" timestamp with time zone,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."oauthClient" (
	"id" text PRIMARY KEY NOT NULL,
	"clientId" text NOT NULL,
	"clientSecret" text,
	"clientDiscoveryId" text,
	"disabled" boolean DEFAULT false,
	"skipConsent" boolean,
	"enableEndSession" boolean,
	"subjectType" text,
	"scopes" text[],
	"clientCredentialsScopes" text[] DEFAULT '{}',
	"userId" text,
	"createdAt" timestamp with time zone,
	"updatedAt" timestamp with time zone,
	"name" text,
	"uri" text,
	"icon" text,
	"contacts" text[],
	"tos" text,
	"policy" text,
	"softwareId" text,
	"softwareVersion" text,
	"softwareStatement" text,
	"redirectUris" text[] NOT NULL,
	"postLogoutRedirectUris" text[],
	"backchannelLogoutUri" text,
	"backchannelLogoutSessionRequired" boolean,
	"tokenEndpointAuthMethod" text,
	"applicationType" text,
	"jwks" text,
	"jwksUri" text,
	"grantTypes" text[],
	"responseTypes" text[],
	"requirePKCE" boolean,
	"dpopBoundAccessTokens" boolean DEFAULT false,
	"referenceId" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "identity"."oauthClientAssertion" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."oauthClientResource" (
	"id" text PRIMARY KEY NOT NULL,
	"clientId" text NOT NULL,
	"resourceId" text NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity"."oauthConsent" (
	"id" text PRIMARY KEY NOT NULL,
	"clientId" text NOT NULL,
	"userId" text,
	"referenceId" text,
	"resources" text[],
	"requestedUserInfoClaims" text[],
	"scopes" text[] NOT NULL,
	"createdAt" timestamp with time zone,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity"."oauthRefreshToken" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"clientId" text NOT NULL,
	"sessionId" text,
	"userId" text NOT NULL,
	"referenceId" text,
	"authorizationCodeId" text,
	"resources" text[],
	"requestedUserInfoClaims" text[],
	"expiresAt" timestamp with time zone,
	"createdAt" timestamp with time zone,
	"revoked" timestamp with time zone,
	"rotatedAt" timestamp with time zone,
	"rotationReplayResponse" text,
	"rotationReplayExpiresAt" timestamp with time zone,
	"authTime" timestamp with time zone,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."oauthResource" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"accessTokenTtl" integer,
	"refreshTokenTtl" integer,
	"signingAlgorithm" text,
	"signingKeyId" text,
	"allowedScopes" text[],
	"customClaims" jsonb,
	"dpopBoundAccessTokensRequired" boolean DEFAULT false,
	"disabled" boolean DEFAULT false,
	"createdAt" timestamp with time zone,
	"updatedAt" timestamp with time zone,
	"policyVersion" integer DEFAULT 1,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "identity"."session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."admin_subject_links" (
	"auth_user_id" text PRIMARY KEY NOT NULL,
	"admin_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."browser_sessions" (
	"handle_hash" text PRIMARY KEY NOT NULL,
	"service_client_id" text NOT NULL,
	"origin" text NOT NULL,
	"auth_user_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"input_sha256" text NOT NULL,
	"token_ciphertext" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "browser_sessions_status_check" CHECK ("identity"."browser_sessions"."status" IN ('active','refreshing','login_required','revoked'))
);
--> statement-breakpoint
CREATE TABLE "dream"."operation_receipts" (
	"service_client_id" text NOT NULL,
	"actor" text NOT NULL,
	"operation" text NOT NULL,
	"request_id" text NOT NULL,
	"input_sha256" text NOT NULL,
	"result" jsonb NOT NULL,
	"committed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operation_receipts_service_client_id_actor_operation_request_id_pk" PRIMARY KEY("service_client_id","actor","operation","request_id"),
	CONSTRAINT "operation_receipts_hash_check" CHECK ("dream"."operation_receipts"."input_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "identity"."runtime_delegations" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"service_client_id" text NOT NULL,
	"auth_user_id" text NOT NULL,
	"canonical_user_id" bigint NOT NULL,
	"thread_id" text NOT NULL,
	"run_id" text,
	"scopes" text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."subject_links" (
	"auth_user_id" text PRIMARY KEY NOT NULL,
	"canonical_user_id" bigint NOT NULL,
	"evidence" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "identity_oauthClient_clientId_idx" ON "identity"."oauthClient" USING btree ("clientId");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_oauthResource_identifier_idx" ON "identity"."oauthResource" USING btree ("identifier");--> statement-breakpoint
ALTER TABLE "identity"."account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "identity"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_clientId_oauthClient_clientId_fk" FOREIGN KEY ("clientId") REFERENCES "identity"."oauthClient"("clientId") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_sessionId_session_id_fk" FOREIGN KEY ("sessionId") REFERENCES "identity"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_refreshId_oauthRefreshToken_id_fk" FOREIGN KEY ("refreshId") REFERENCES "identity"."oauthRefreshToken"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."oauthClient" ADD CONSTRAINT "oauthClient_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."oauthClientResource" ADD CONSTRAINT "oauthClientResource_clientId_oauthClient_clientId_fk" FOREIGN KEY ("clientId") REFERENCES "identity"."oauthClient"("clientId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."oauthClientResource" ADD CONSTRAINT "oauthClientResource_resourceId_oauthResource_identifier_fk" FOREIGN KEY ("resourceId") REFERENCES "identity"."oauthResource"("identifier") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."oauthConsent" ADD CONSTRAINT "oauthConsent_clientId_oauthClient_clientId_fk" FOREIGN KEY ("clientId") REFERENCES "identity"."oauthClient"("clientId") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."oauthConsent" ADD CONSTRAINT "oauthConsent_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."oauthRefreshToken" ADD CONSTRAINT "oauthRefreshToken_clientId_oauthClient_clientId_fk" FOREIGN KEY ("clientId") REFERENCES "identity"."oauthClient"("clientId") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."oauthRefreshToken" ADD CONSTRAINT "oauthRefreshToken_sessionId_session_id_fk" FOREIGN KEY ("sessionId") REFERENCES "identity"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."oauthRefreshToken" ADD CONSTRAINT "oauthRefreshToken_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "identity"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."admin_subject_links" ADD CONSTRAINT "admin_subject_links_auth_user_id_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."admin_subject_links" ADD CONSTRAINT "admin_subject_links_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."browser_sessions" ADD CONSTRAINT "browser_sessions_auth_user_id_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."runtime_delegations" ADD CONSTRAINT "runtime_delegations_auth_user_id_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."runtime_delegations" ADD CONSTRAINT "runtime_delegations_canonical_user_id_users_id_fk" FOREIGN KEY ("canonical_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."subject_links" ADD CONSTRAINT "subject_links_auth_user_id_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."subject_links" ADD CONSTRAINT "subject_links_canonical_user_id_users_id_fk" FOREIGN KEY ("canonical_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "identity_account_provider_account_uidx" ON "identity"."account" USING btree ("providerId","accountId");--> statement-breakpoint
CREATE INDEX "identity_account_userId_idx" ON "identity"."account" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_deviceCode_deviceCode_uidx" ON "identity"."deviceCode" USING btree ("deviceCode");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_deviceCode_userCode_uidx" ON "identity"."deviceCode" USING btree ("userCode");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_oauthAccessToken_token_idx" ON "identity"."oauthAccessToken" USING btree ("token");--> statement-breakpoint
CREATE INDEX "identity_oauthAccessToken_clientId_idx" ON "identity"."oauthAccessToken" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX "identity_oauthAccessToken_sessionId_idx" ON "identity"."oauthAccessToken" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX "identity_oauthAccessToken_userId_idx" ON "identity"."oauthAccessToken" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "identity_oauthAccessToken_authorizationCodeId_idx" ON "identity"."oauthAccessToken" USING btree ("authorizationCodeId");--> statement-breakpoint
CREATE INDEX "identity_oauthAccessToken_refreshId_idx" ON "identity"."oauthAccessToken" USING btree ("refreshId");--> statement-breakpoint
CREATE INDEX "identity_oauthClient_userId_idx" ON "identity"."oauthClient" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "identity_oauthClientResource_clientId_idx" ON "identity"."oauthClientResource" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX "identity_oauthClientResource_resourceId_idx" ON "identity"."oauthClientResource" USING btree ("resourceId");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_oauthClientResource_clientId_resourceId_uidx" ON "identity"."oauthClientResource" USING btree ("clientId","resourceId");--> statement-breakpoint
CREATE INDEX "identity_oauthConsent_clientId_idx" ON "identity"."oauthConsent" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX "identity_oauthConsent_userId_idx" ON "identity"."oauthConsent" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_oauthRefreshToken_token_idx" ON "identity"."oauthRefreshToken" USING btree ("token");--> statement-breakpoint
CREATE INDEX "identity_oauthRefreshToken_clientId_idx" ON "identity"."oauthRefreshToken" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX "identity_oauthRefreshToken_sessionId_idx" ON "identity"."oauthRefreshToken" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX "identity_oauthRefreshToken_userId_idx" ON "identity"."oauthRefreshToken" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "identity_oauthRefreshToken_authorizationCodeId_idx" ON "identity"."oauthRefreshToken" USING btree ("authorizationCodeId");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_session_token_idx" ON "identity"."session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "identity_session_userId_idx" ON "identity"."session" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_user_email_idx" ON "identity"."user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "identity_verification_identifier_idx" ON "identity"."verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_subject_links_admin_uidx" ON "identity"."admin_subject_links" USING btree ("admin_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "browser_sessions_transaction_uidx" ON "identity"."browser_sessions" USING btree ("service_client_id","transaction_id");--> statement-breakpoint
CREATE INDEX "browser_sessions_subject_expiry_idx" ON "identity"."browser_sessions" USING btree ("auth_user_id","expires_at");--> statement-breakpoint
CREATE INDEX "runtime_delegations_thread_idx" ON "identity"."runtime_delegations" USING btree ("thread_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subject_links_canonical_uidx" ON "identity"."subject_links" USING btree ("canonical_user_id");
--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (capability, version, contract_sha256, adopted_from, metadata)
VALUES ('identity.better-auth.v1', 1, '1dc05e229d3f4147923fcdfe117c4c4930a43bf9f31439d7b4bc83d2a0d04cd3', '0054_clean_network', '{"better_auth":"1.7.4","oauth_provider":"1.7.4","schema":"identity","phase":"expand"}'::jsonb);
