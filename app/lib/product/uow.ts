import type { PoolClient } from "pg";
import { withPlatformClient } from "../platform-db";

export type ProductReadUnitOfWork = <T>(
  handler: (client: PoolClient) => Promise<T>,
) => Promise<T>;

export const withProductReadUnitOfWork: ProductReadUnitOfWork = async (
  handler,
) => {
  return await withPlatformClient(async (client) => {
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    try {
      const result = await handler(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
};

