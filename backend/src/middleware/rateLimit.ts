import type { NextFunction, Request, Response } from "express";

/**
 * Minimal in-memory fixed-window limiter, keyed by a field in the request
 * body plus the route. Good enough for a single-instance pilot; swap for a
 * Redis-backed limiter before scaling to multiple API instances.
 */
export function rateLimitByBodyField(field: string, max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.path}:${String(req.body?.[field] ?? req.ip)}`;
    const now = Date.now();
    const windowStart = now - windowMs;
    const timestamps = (hits.get(key) ?? []).filter((t) => t > windowStart);
    if (timestamps.length >= max) {
      res.status(429).json({ error: "Too many requests, try again later" });
      return;
    }
    timestamps.push(now);
    hits.set(key, timestamps);
    next();
  };
}
