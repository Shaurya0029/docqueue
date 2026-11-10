import type { Role } from "../types/api";

export function homePathForRole(role: Role): string {
  switch (role) {
    case "PATIENT":
      return "/patient";
    case "DOCTOR":
      return "/doctor";
    case "ASSOCIATE":
      return "/associate";
    case "ADMIN":
      return "/admin";
  }
}
