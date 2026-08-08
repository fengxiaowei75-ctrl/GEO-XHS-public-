import { describe, it, expect } from "vitest";
import { canAccess, firstAllowedView } from "./validators";

describe("canAccess", () => {
  it("admin 有所有权限", () => {
    const admin = { role: "admin", permissions: {} };
    expect(canAccess(admin, "content")).toBe(true);
    expect(canAccess(admin, "admin")).toBe(true);
  });

  it("viewer 有显式权限时返回 true", () => {
    const viewer = { role: "viewer", permissions: { content: true } };
    expect(canAccess(viewer, "content")).toBe(true);
  });

  it("viewer 无权限时返回 false", () => {
    const viewer = { role: "viewer", permissions: { content: false } };
    expect(canAccess(viewer, "admin")).toBe(false);
  });

  it("未登录用户返回 false", () => {
    expect(canAccess(null, "content")).toBe(false);
    expect(canAccess(undefined, "content")).toBe(false);
  });

  it("空权限对象默认无权限", () => {
    const user = { role: "viewer", permissions: {} };
    expect(canAccess(user, "content")).toBe(false);
  });
});

describe("firstAllowedView", () => {
  it("admin 返回第一个导航项", () => {
    const admin = { role: "admin" };
    expect(firstAllowedView(admin)).toBe("content");
  });

  it("无权限用户返回默认 content", () => {
    const user = { role: "viewer", permissions: {} };
    expect(firstAllowedView(user)).toBe("content");
  });

  it("空用户返回默认 content", () => {
    expect(firstAllowedView(null)).toBe("content");
  });
});
