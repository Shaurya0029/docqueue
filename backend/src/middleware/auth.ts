import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../lib/jwt";
import { isRevoked } from "../lib/revocation";
import type { Role } from "@prisma/client";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }
  let auth;
  try {
    auth = verifyAccessToken(header.slice("Bearer ".length));
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  // A deleted or deactivated account loses access at once, not when its token expires.
  isRevoked(auth.userId)
    .then((revoked) => {
      if (revoked) {
        res.status(401).json({ error: "This account is no longer active" });
        return;
      }
      req.auth = auth;
      next();
    })
    .catch(next);
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
