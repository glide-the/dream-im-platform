import { afterEach, describe, expect, it, vi } from "vitest";

import { validatedDatabaseUrl } from "./db";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("validatedDatabaseUrl", () => {
  it("keeps the canonical runtime database name strict", () => {
    vi.stubEnv("INK_USE_TEST_DATABASE_URL", "");
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/ink-memory");
    expect(validatedDatabaseUrl()).toBe(process.env.DATABASE_URL);

    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://localhost/ink_memory_admin_codex_test",
    );
    expect(() => validatedDatabaseUrl()).toThrow(
      "DATABASE_URL must use the ink-memory database.",
    );
  });

  it("allows only an explicit non-production test/codex database", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("INK_USE_TEST_DATABASE_URL", "1");
    vi.stubEnv(
      "TEST_DATABASE_URL",
      "postgresql://localhost/ink_memory_admin_e2e_codex_test",
    );
    expect(validatedDatabaseUrl()).toBe(process.env.TEST_DATABASE_URL);

    vi.stubEnv("TEST_DATABASE_URL", "postgresql://localhost/ink-memory");
    expect(() => validatedDatabaseUrl()).toThrow(
      "TEST_DATABASE_URL must name an explicitly isolated test/codex database.",
    );
  });

  it("refuses the test override in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("INK_USE_TEST_DATABASE_URL", "1");
    vi.stubEnv(
      "TEST_DATABASE_URL",
      "postgresql://localhost/ink_memory_admin_e2e_codex_test",
    );
    expect(() => validatedDatabaseUrl()).toThrow(
      "TEST_DATABASE_URL is forbidden in production.",
    );
  });
});
