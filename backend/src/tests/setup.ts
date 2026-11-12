import { beforeEach } from "vitest";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";

/** Empties every application table (all of them, so new tables need no change here). */
export async function resetDb(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

beforeEach(async () => {
  await resetDb();
  if (!/\/2$/.test(process.env.REDIS_URL ?? "")) throw new Error("Tests must use Redis database 2");
  await redis.flushdb();
});
