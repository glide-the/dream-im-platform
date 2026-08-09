import { describe, expect, it } from "vitest";
import { AdminError } from "./errors";
import {
  buildAdminListClauses,
  parseAdminListQuery,
} from "./list-query";

const config = {
  sortFields: ["created_at", "email"],
  filterFields: ["status", "email", "created_at"],
  defaultSort: "created_at",
};

describe("admin list query", () => {
  it("parses bounded paging and builds parameterized filters", () => {
    const query = parseAdminListQuery(
      new Request(
        "http://localhost/api/admin/users?page=2&pageSize=10&sort=email&order=asc&filter[email][contains]=ink",
      ),
      config,
    );
    const clauses = buildAdminListClauses(query, {
      columns: { created_at: "u.created_at", email: "u.email", status: "u.status" },
    });
    expect(clauses.whereSql).toBe("WHERE u.email ILIKE $1");
    expect(clauses.orderSql).toBe("ORDER BY u.email ASC");
    expect(clauses.parameters).toEqual(["%ink%", 10, 10]);
  });

  it("rejects unknown fields and oversized pages", () => {
    expect(() =>
      parseAdminListQuery(
        new Request("http://localhost/api/admin/users?pageSize=1000"),
        config,
      ),
    ).toThrowError(AdminError);
    expect(() =>
      parseAdminListQuery(
        new Request("http://localhost/api/admin/users?sort=password_hash"),
        config,
      ),
    ).toThrowError(AdminError);
  });

  it("builds a parameterized inclusive date range for data and count queries", () => {
    const query = parseAdminListQuery(
      new Request(
        "http://localhost/api/admin/users?filter[created_at][gte]=2026-08-01T00%3A00%3A00.000Z&filter[created_at][lte]=2026-08-31T23%3A59%3A59.000Z",
      ),
      config,
    );
    const clauses = buildAdminListClauses(query, {
      columns: {
        created_at: "u.created_at",
        email: "u.email",
        status: "u.status",
      },
    });

    expect(clauses.whereSql).toBe(
      "WHERE u.created_at >= $1 AND u.created_at <= $2",
    );
    expect(clauses.parameters).toEqual([
      "2026-08-01T00:00:00.000Z",
      "2026-08-31T23:59:59.000Z",
      20,
      0,
    ]);
  });
});
