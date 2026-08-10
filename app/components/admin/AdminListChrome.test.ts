import { describe, expect, it } from "vitest";

import {
  countActiveFilterValues,
  haveFilterValuesChanged,
} from "./AdminListChrome";

describe("admin list filter state", () => {
  it("counts only meaningful applied values", () => {
    expect(countActiveFilterValues({ search: "  alice  ", status: "", enabled: false, tags: [] })).toBe(1);
    expect(countActiveFilterValues({ status: "active", providerId: "provider-1", page: 0 })).toBe(3);
  });

  it("distinguishes a pending draft without depending on key order or whitespace", () => {
    expect(haveFilterValuesChanged({ status: " active ", email: "a@example.com" }, { email: "a@example.com", status: "active" })).toBe(false);
    expect(haveFilterValuesChanged({ status: "disabled" }, { status: "active" })).toBe(true);
    expect(haveFilterValuesChanged({}, { status: "active" })).toBe(true);
  });
});
