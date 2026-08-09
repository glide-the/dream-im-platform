import { AdminError } from "./errors";

export type AdminListQuery = {
  page: number;
  pageSize: number;
  sort?: string;
  order: "asc" | "desc";
  filters: Array<{
    field: string;
    operator: "eq" | "contains" | "in" | "gte" | "lte";
    value: string;
  }>;
};

function integerParam(value: string | null, fallback: number) {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

export function parseAdminListQuery(
  request: Request,
  config: {
    sortFields: readonly string[];
    filterFields: readonly string[];
    defaultSort: string;
  },
): AdminListQuery {
  const params = new URL(request.url).searchParams;
  const page = integerParam(params.get("page"), 1);
  const pageSize = integerParam(params.get("pageSize"), 20);
  if (page < 1 || pageSize < 1 || pageSize > 100) {
    throw new AdminError(
      "ADMIN_PAGINATION_INVALID",
      "page must be >= 1 and pageSize must be between 1 and 100",
      400,
    );
  }
  const sort = params.get("sort") ?? config.defaultSort;
  if (!config.sortFields.includes(sort)) {
    throw new AdminError(
      "ADMIN_SORT_INVALID",
      `Sort field ${sort} is not allowed`,
      400,
    );
  }
  const order = params.get("order") ?? "desc";
  if (order !== "asc" && order !== "desc") {
    throw new AdminError(
      "ADMIN_SORT_INVALID",
      "Sort order must be asc or desc",
      400,
    );
  }

  const filters: AdminListQuery["filters"] = [];
  for (const [key, value] of params.entries()) {
    if (["page", "pageSize", "sort", "order"].includes(key)) continue;
    const match = /^filter\[([^\]]+)]\[(eq|contains|in|gte|lte)]$/.exec(key);
    if (!match || !config.filterFields.includes(match[1])) {
      throw new AdminError(
        "ADMIN_FILTER_INVALID",
        `Filter ${key} is not allowed`,
        400,
      );
    }
    if (
      (match[2] === "gte" || match[2] === "lte") &&
      Number.isNaN(Date.parse(value))
    ) {
      throw new AdminError(
        "ADMIN_FILTER_INVALID",
        `Filter ${match[1]} must be a valid date-time`,
        400,
      );
    }
    filters.push({
      field: match[1],
      operator: match[2] as "eq" | "contains" | "in" | "gte" | "lte",
      value,
    });
  }
  return { page, pageSize, sort, order, filters };
}

export function buildAdminListClauses(
  query: AdminListQuery,
  config: {
    columns: Record<string, string>;
    startParameter?: number;
  },
) {
  const parameters: unknown[] = [];
  const where: string[] = [];
  const start = config.startParameter ?? 1;
  for (const filter of query.filters) {
    const column = config.columns[filter.field];
    if (!column) {
      throw new AdminError(
        "ADMIN_FILTER_INVALID",
        `Filter field ${filter.field} is not registered`,
        400,
      );
    }
    const parameter = `$${start + parameters.length}`;
    if (filter.operator === "contains") {
      where.push(`${column} ILIKE ${parameter}`);
      parameters.push(`%${filter.value}%`);
    } else if (filter.operator === "in") {
      const values = filter.value.split(",").filter(Boolean).slice(0, 50);
      where.push(`${column} = ANY(${parameter}::text[])`);
      parameters.push(values);
    } else if (filter.operator === "gte") {
      where.push(`${column} >= ${parameter}`);
      parameters.push(filter.value);
    } else if (filter.operator === "lte") {
      where.push(`${column} <= ${parameter}`);
      parameters.push(filter.value);
    } else {
      where.push(`${column} = ${parameter}`);
      parameters.push(filter.value);
    }
  }
  const sortColumn = config.columns[query.sort ?? ""];
  if (!sortColumn) {
    throw new AdminError(
      "ADMIN_SORT_INVALID",
      `Sort field ${query.sort} is not registered`,
      400,
    );
  }
  const limitParameter = `$${start + parameters.length}`;
  parameters.push(query.pageSize);
  const offsetParameter = `$${start + parameters.length}`;
  parameters.push((query.page - 1) * query.pageSize);
  return {
    whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "",
    orderSql: `ORDER BY ${sortColumn} ${query.order.toUpperCase()}`,
    pageSql: `LIMIT ${limitParameter} OFFSET ${offsetParameter}`,
    parameters,
  };
}

export function adminListResponse<T>(
  data: T[],
  query: AdminListQuery,
  total: number,
) {
  return {
    data,
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    },
  };
}
