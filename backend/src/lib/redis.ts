import Redis from "ioredis";
import { env } from "./env";

export const redis = new Redis(env.redisUrl);
export const redisPub = new Redis(env.redisUrl);
export const redisSub = new Redis(env.redisUrl);

export function queueChannel(doctorId: string): string {
  return `queue:${doctorId}`;
}

export function nowServingKey(doctorId: string, date: string): string {
  return `doctor:${doctorId}:${date}:now_serving`;
}

export async function publishQueueEvent(doctorId: string, event: unknown): Promise<void> {
  await redisPub.publish(queueChannel(doctorId), JSON.stringify(event));
}
