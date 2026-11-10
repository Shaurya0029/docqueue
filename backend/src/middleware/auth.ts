import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../lib/jwt";
import type { Role } from "@prisma/client";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }
  try {
    req.auth = verifyAccessToken(header.slice("Bearer ".length));
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: "Missing bearer token" });
      return;
    }
    if (!roles.includes(req.auth.role)) {
      res.status(403).json({ error: "Forbidden for this role" });
      return;
    }
    next();
  };
}
