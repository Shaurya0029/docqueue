import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import type { Role } from "../types/api";
import { homePathForRole } from "./homePathForRole";

export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={homePathForRole(user.role)} replace />;
  return <>{children}</>;
}
