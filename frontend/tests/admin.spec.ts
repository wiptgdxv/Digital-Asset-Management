import { expect, request as requestFactory, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test("管理员授权、密码重置与项目删除权限", async ({ page, request }) => {
  const key = randomUUID().replaceAll("-", "").slice(0, 12);
  const password = "Test-Only-Pass-1023";
  const ownerUsername = `admin-owner-${key}`;
  const adminUsername = `admin-initial-${key}`;
  const delegateUsername = `admin-delegate-${key}`;
  const forgottenUsername = `admin-forgotten-${key}`;
  const newPassword = "Changed-Only-Pass-2048";
  const baseURL = "http://127.0.0.1:5173";
  const accounts = [
    { name: "删除项目作者", username: ownerUsername },
    { name: "初始管理员", username: adminUsername },
    { name: "接任管理员", username: delegateUsername },
    { name: "忘记密码员工", username: forgottenUsername },
  ];
  const contexts = [];

  try {
    for (const account of accounts) {
      expect(
        (
          await request.post("/api/v1/auth/register", {
            data: { ...account, password },
          })
        ).status(),
      ).toBe(200);
    }
    execFileSync(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        "assets",
        "-d",
        "assets",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `UPDATE users SET is_admin=true WHERE username='${adminUsername}';`,
      ],
      { cwd: "..", stdio: "pipe" },
    );
    for (const account of accounts) {
      const context = await requestFactory.newContext({ baseURL });
      expect(
        (
          await context.post("/api/v1/auth/login", {
            data: { username: account.username, password },
          })
        ).status(),
      ).toBe(200);
      contexts.push(context);
    }

    const [ownerApi, adminApi, delegateApi, forgottenApi] = contexts;
    const ownerMe = await (await ownerApi.get("/api/v1/auth/me")).json();
    const adminMe = await (await adminApi.get("/api/v1/auth/me")).json();
    const delegateMe = await (await delegateApi.get("/api/v1/auth/me")).json();
    expect(adminMe.user.isAdmin).toBe(true);
    expect(ownerMe.user.isAdmin).toBe(false);
    const forgottenMe = await (
      await forgottenApi.get("/api/v1/auth/me")
    ).json();
    expect(
      (
        await ownerApi.put(`/api/v1/users/${ownerMe.user.id}/admin`, {
          headers: { "X-CSRF-Token": ownerMe.csrfToken },
          data: { isAdmin: true },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await ownerApi.post(
          `/api/v1/users/${forgottenMe.user.id}/reset-password`,
          { headers: { "X-CSRF-Token": ownerMe.csrfToken } },
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await adminApi.post(`/api/v1/users/${adminMe.user.id}/reset-password`, {
          headers: { "X-CSRF-Token": adminMe.csrfToken },
        })
      ).status(),
    ).toBe(400);

    await page.goto("/");
    await page.getByLabel("用户名", { exact: true }).fill(adminUsername);
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.getByRole("button", { name: "员工权限" }).click();
    await expect(page.getByRole("heading", { name: "员工权限" })).toBeVisible();
    await page.getByLabel("查找员工").fill(adminUsername);
    const currentAdminRow = page.locator(".admin-table tbody tr").filter({
      hasText: adminUsername,
    });
    await expect(
      currentAdminRow.getByRole("button", { name: "修改密码" }),
    ).toBeEnabled();
    await page.getByLabel("查找员工").fill(delegateUsername);
    const delegateRow = page.locator(".admin-table tbody tr").filter({
      hasText: delegateUsername,
    });
    page.once("dialog", (dialog) => dialog.accept());
    await delegateRow.getByRole("button", { name: "设为管理员" }).click();
    await expect(delegateRow).toContainText("管理员");
    await page.screenshot({
      path: "test-results/admin-users.png",
      fullPage: true,
    });
    expect(
      (await (await delegateApi.get("/api/v1/auth/me")).json()).user.isAdmin,
    ).toBe(true);

    await page.getByLabel("查找员工").fill(forgottenUsername);
    const forgottenRow = page.locator(".admin-table tbody tr").filter({
      hasText: forgottenUsername,
    });
    page.once("dialog", (dialog) => dialog.accept());
    await forgottenRow
      .getByRole("button", { name: "重置密码", exact: true })
      .click();
    const temporaryPassword =
      (await page.locator(".password-reset-result code").textContent()) ?? "";
    expect(temporaryPassword).toHaveLength(18);
    expect((await forgottenApi.get("/api/v1/auth/me")).status()).toBe(401);
    expect(
      (
        await request.post("/api/v1/auth/login", {
          data: { username: forgottenUsername, password },
        })
      ).status(),
    ).toBe(401);

    const forcedApi = await requestFactory.newContext({ baseURL });
    contexts.push(forcedApi);
    const forcedLogin = await forcedApi.post("/api/v1/auth/login", {
      data: { username: forgottenUsername, password: temporaryPassword },
    });
    expect(forcedLogin.status()).toBe(200);
    const forcedSession = await forcedLogin.json();
    expect(forcedSession.mustChangePassword).toBe(true);
    expect((await forcedApi.get("/api/v1/projects")).status()).toBe(403);

    await page.getByRole("button", { name: "退出登录" }).click();
    await page.getByLabel("用户名", { exact: true }).fill(forgottenUsername);
    await page.getByLabel("密码", { exact: true }).fill(temporaryPassword);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "设置新密码" }),
    ).toBeVisible();
    await page.getByLabel("临时密码").fill(temporaryPassword);
    await page.getByLabel("新密码", { exact: true }).fill(newPassword);
    await page.getByLabel("再次输入新密码").fill(newPassword);
    await page.getByRole("button", { name: "保存新密码" }).click();
    await expect(page.getByRole("heading", { name: "项目广场" })).toBeVisible();
    expect((await forcedApi.get("/api/v1/auth/me")).status()).toBe(401);
    expect(
      (
        await request.post("/api/v1/auth/login", {
          data: { username: forgottenUsername, password: temporaryPassword },
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await request.post("/api/v1/auth/login", {
          data: { username: forgottenUsername, password: newPassword },
        })
      ).status(),
    ).toBe(200);

    expect(
      (
        await adminApi.put(`/api/v1/users/${adminMe.user.id}/admin`, {
          headers: { "X-CSRF-Token": adminMe.csrfToken },
          data: { isAdmin: false },
        })
      ).status(),
    ).toBe(200);
    const createProject = async (name: string) => {
      const response = await ownerApi.post("/api/v1/projects", {
        headers: { "X-CSRF-Token": ownerMe.csrfToken },
        data: {
          name,
          summary: "删除权限验收",
          readme: "# 删除权限验收",
          category: "其他",
          demoEnabled: false,
          collaboratorIds: [],
        },
      });
      expect(response.status()).toBe(200);
      return response.json();
    };
    const adminDeleteProject = await createProject("管理员删除 " + key);
    const adminManagedProject = await (
      await delegateApi.put(`/api/v1/projects/${adminDeleteProject.id}`, {
        headers: { "X-CSRF-Token": delegateMe.csrfToken },
        data: {
          version: adminDeleteProject.version,
          name: adminDeleteProject.name,
          summary: adminDeleteProject.summary,
          readme: adminDeleteProject.readme,
          category: adminDeleteProject.category,
          demoEnabled: adminDeleteProject.demoEnabled,
          collaboratorIds: [adminMe.user.id],
        },
      })
    ).json();
    expect(
      adminManagedProject.collaborators.map((user: { id: number }) => user.id),
    ).toEqual([adminMe.user.id]);
    expect(
      (
        await adminApi.delete(`/api/v1/projects/${adminDeleteProject.id}`, {
          headers: { "X-CSRF-Token": adminMe.csrfToken },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await delegateApi.delete(`/api/v1/projects/${adminDeleteProject.id}`, {
          headers: { "X-CSRF-Token": delegateMe.csrfToken },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await ownerApi.get(`/api/v1/projects/${adminDeleteProject.id}`)
      ).status(),
    ).toBe(404);

    const ownerDeleteProject = await createProject("作者删除 " + key);
    await page.getByRole("button", { name: "退出登录" }).click();
    await page.getByLabel("用户名", { exact: true }).fill(ownerUsername);
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.getByLabel("搜索项目").fill("作者删除 " + key);
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await page
      .getByRole("button", { name: ownerDeleteProject.name, exact: true })
      .click();
    page.once("dialog", (dialog) => dialog.accept(ownerDeleteProject.name));
    await page.getByRole("button", { name: "删除项目" }).click();
    await expect(page.getByRole("heading", { name: "项目广场" })).toBeVisible();
    expect(
      (
        await ownerApi.get(`/api/v1/projects/${ownerDeleteProject.id}`)
      ).status(),
    ).toBe(404);
  } finally {
    await Promise.all(contexts.map((context) => context.dispose()));
    execFileSync(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        "assets",
        "-d",
        "assets",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `BEGIN; DELETE FROM projects WHERE author_id IN (SELECT id FROM users WHERE username IN ('${ownerUsername}','${adminUsername}','${delegateUsername}','${forgottenUsername}')); DELETE FROM users WHERE username IN ('${ownerUsername}','${adminUsername}','${delegateUsername}','${forgottenUsername}'); COMMIT;`,
      ],
      { cwd: "..", stdio: "pipe" },
    );
  }
});
