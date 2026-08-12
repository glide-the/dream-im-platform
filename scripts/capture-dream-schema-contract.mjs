import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { captureDreamSchemaContract } from "./lib/dream-schema-contract.mjs";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--output") {
  throw new Error("Usage: node scripts/capture-dream-schema-contract.mjs --output <path>");
}
const databaseUrl = process.env.MIGRATION_DATABASE_URL;
if (!databaseUrl) throw new Error("MIGRATION_DATABASE_URL is required");

const namesPath = fileURLToPath(
  new URL("../drizzle/contracts/dream-table-names.json", import.meta.url),
);
const tableNames = JSON.parse(await readFile(namesPath, "utf8"));
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query("BEGIN READ ONLY");
  const contract = await captureDreamSchemaContract(client, tableNames);
  await client.query("ROLLBACK");
  await writeFile(args[1], `${JSON.stringify(contract, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({
    output: args[1],
    contractSha256: contract.contractSha256,
    catalogSha256: contract.catalogSha256,
    physicalCounts: contract.physicalCounts,
  }));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
