import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  permanentRedirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  permanentRedirect: mocks.permanentRedirect,
}));

import ModelPermissionsPage from "./page";

describe("legacy model permissions route", () => {
  beforeEach(() => mocks.permanentRedirect.mockClear());

  it("redirects to the single gateway limit-policy entry", () => {
    ModelPermissionsPage();

    expect(mocks.permanentRedirect).toHaveBeenCalledWith(
      "/admin/gateway/rate-limits#user-model-permissions-manager",
    );
  });
});
