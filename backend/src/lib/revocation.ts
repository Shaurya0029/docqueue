import { redis } from "./redis";

/** Access tokens live 2 hours (lib/jwt.ts); a revocation must outlast them. */
const REVOKE_SECONDS = 2 * 3600 + 300;

const key = (userId: string) => `revoked:user:${userId}`;

/** Ends every session of a user now (account deleted or deactivated). */
export async function revokeUserSessions(userId: string): Promise<void> {
  await redis.set(key(userId), "1", "EX", REVOKE_SECONDS);
}

export async function isRevoked(userId: string): Promise<boolean> {
  return (await redis.exists(key(userId))) === 1;
}
