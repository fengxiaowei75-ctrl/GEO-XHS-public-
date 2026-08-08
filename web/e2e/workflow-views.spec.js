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

  await page.route("**/api/image-note", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: "e2e skips note detail",
      }),
    });
  });
}

async function login(page) {
  await mockDashboardSession(page);
  await page.goto("/");
  await page.getByLabel("账号").fill("admin");
  await page.getByLabel("密码").fill("password");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "市场需求洞察", level: 1 })).toBeVisible();
}

test("renders fixed content and draft review views", async ({ page }) => {
  await login(page);

  await page.getByRole("button", { name: "固定内容流" }).click();
  await expect(page.getByRole("heading", { name: "固定内容流", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "资产执行" })).toBeVisible();

  await page.getByRole("button", { name: "待审核草稿" }).click();
  await expect(page.getByRole("heading", { name: "待审核草稿", level: 1 })).toBeVisible();
  await expect(page.getByText("暂无待审核草稿").first()).toBeVisible();
});
