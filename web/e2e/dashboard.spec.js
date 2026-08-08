import { expect, test } from "@playwright/test";

const permissionCatalog = {
  content: "GEO红书需求洞察",
  ops: "运行监控",
  models: "模型配置",
  admin: "管理员配置",
};

const adminUser = {
  user_id: 1,
  username: "e2e-admin",
  role: "admin",
  active: true,
  permissions: {
    content: true,
    ops: true,
    models: true,
    admin: true,
  },
};

async function mockDashboardSession(page) {
  let authenticated = false;

  await page.route("**/api/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        authenticated,
        user: authenticated ? adminUser : null,
        permissions: permissionCatalog,
      }),
    });
  });

  await page.route("**/api/login", async (route) => {
    authenticated = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "Set-Cookie": "geo_xhs_session=e2e; Path=/; SameSite=Lax",
      },
      body: JSON.stringify({
        ok: true,
        user: adminUser,
        permissions: permissionCatalog,
      }),
    });
  });

  await page.route("**/api/logout", async (route) => {
    authenticated = false;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.route("**/api/dashboard**", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: "e2e uses local sample data",
      }),
    });
  });
}

test("logs in and renders the main dashboard views with sample data fallback", async ({ page }) => {
  await mockDashboardSession(page);

  await page.goto("/");
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();

  await page.getByLabel("账号").fill("admin");
  await page.getByLabel("密码").fill("password");
  await page.getByRole("button", { name: "登录" }).click();

  await expect(page.getByRole("heading", { name: "市场需求洞察", level: 1 })).toBeVisible();
  await expect(page.getByText("当前为样例数据")).toBeVisible();
  await expect(page.getByRole("heading", { name: "笔记数据概览" })).toBeVisible();
  await expect(page.getByText("每天拆解一个运营知识-GEO排名优化").first()).toBeVisible();

  await page.getByPlaceholder("搜索标题、人群、主题、痛点").fill("GEO排名优化");
  await expect(page.getByText("每天拆解一个运营知识-GEO排名优化").first()).toBeVisible();

  await page.getByRole("button", { name: "运行监控" }).click();
  await expect(page.getByRole("heading", { name: "运行监控", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "API 调用概况" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "脚本运行状态" })).toBeVisible();
});
