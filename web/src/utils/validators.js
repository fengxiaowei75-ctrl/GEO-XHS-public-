import { navItems } from "../constants/navConfig";

export function canAccess(user, permission) {
  return Boolean(user && (user.role === "admin" || user.permissions?.[permission] === true));
}

export function firstAllowedView(user) {
  return navItems.find((item) => canAccess(user, item.permission))?.id || "content";
}
