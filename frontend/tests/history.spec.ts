import { expect, request as requestFactory, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test("编辑历史默认展示最新记录并可展开全部", async ({ page, request }) => {
  const key = randomUUID().replaceAll("-", "").slice(0, 12);
  const password = "Test-Only-Pass-1023";
  const ownerUsername = `history-owner-${key}`;
  const editorUsername = `history-editor-${key}`;
  const baseURL = "http://127.0.0.1:5173";
  const accounts = [
    { name: "历史项目作者", username: ownerUsername },
    { name: "历史编辑者", username: editorUsername },
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

    const [ownerApi, editorApi] = contexts;
    const ownerMe = await (await ownerApi.get("/api/v1/auth/me")).json();
    const editorMe = await (await editorApi.get("/api/v1/auth/me")).json();
    const originalName = "历史验收 " + key;
    const editedName = "编辑后的历史验收 " + key;
    const createdResponse = await ownerApi.post("/api/v1/projects", {
      headers: { "X-CSRF-Token": ownerMe.csrfToken },
      data: {
        name: originalName,
        summary: "版本一",
        readme: "# 版本一",
        category: "文档",
        demoEnabled: false,
        collaboratorIds: [editorMe.user.id],
      },
    });
    expect(createdResponse.status()).toBe(200);
    const created = await createdResponse.json();

    const editorUpdateResponse = await editorApi.put(
      `/api/v1/projects/${created.id}`,
      {
        headers: { "X-CSRF-Token": editorMe.csrfToken },
        data: {
          version: created.version,
          name: editedName,
          summary: "版本二",
          readme: "# 版本二",
          category: "软件",
          demoEnabled: true,
          collaboratorIds: [editorMe.user.id],
        },
      },
    );
    expect(editorUpdateResponse.status()).toBe(200);
    const versionTwo = await editorUpdateResponse.json();

    expect(
      (
        await ownerApi.put(`/api/v1/projects/${created.id}`, {
          headers: { "X-CSRF-Token": ownerMe.csrfToken },
          data: {
            version: versionTwo.version,
            name: versionTwo.name,
            summary: "版本三",
            readme: versionTwo.readme,
            category: versionTwo.category,
            demoEnabled: versionTwo.demoEnabled,
            collaboratorIds: [editorMe.user.id],
          },
        })
      ).status(),
    ).toBe(200);

    const historyResponse = await ownerApi.get(
      `/api/v1/projects/${created.id}/history?page=1`,
    );
    expect(historyResponse.status()).toBe(200);
    const history = await historyResponse.json();
    expect(history.total).toBe(3);
    expect(
      history.items.map((item: { version: number }) => item.version),
    ).toEqual([3, 2, 1]);
    expect(history.items[0].changedFields).toEqual(["summary"]);
    expect(history.items[1].changedFields).toEqual([
      "name",
      "summary",
      "readme",
      "category",
      "demoEnabled",
    ]);

    const removedRestore = await ownerApi.post(
      `/api/v1/projects/${created.id}/history/${history.items[2].id}/restore`,
      {
        headers: { "X-CSRF-Token": ownerMe.csrfToken },
        data: { version: 3 },
      },
    );
    expect(removedRestore.status()).toBe(404);

    await page.goto("/");
    await page.getByLabel("用户名", { exact: true }).fill(ownerUsername);
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.getByLabel("搜索项目").fill(key);
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await page.getByRole("button", { name: editedName, exact: true }).click();

    await expect(page.getByRole("heading", { name: "编辑历史" })).toBeVisible();
    await expect(page.getByText("共 3 个版本")).toBeVisible();
    await expect(page.locator(".history-list li")).toHaveCount(1);
    await expect(page.locator(".history-list li").first()).toContainText(
      "版本 3",
    );
    await page.getByRole("button", { name: "展开全部历史" }).click();
    await expect(page.locator(".history-list li")).toHaveCount(3);
    await expect(page.getByRole("button", { name: "恢复此版本" })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "只看最新" }).click();
    await expect(page.locator(".history-list li")).toHaveCount(1);
    await page.screenshot({
      path: "test-results/project-history-collapsed.png",
      fullPage: true,
    });
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
        `BEGIN; DELETE FROM projects WHERE author_id IN (SELECT id FROM users WHERE username IN ('${ownerUsername}','${editorUsername}')); DELETE FROM users WHERE username IN ('${ownerUsername}','${editorUsername}'); COMMIT;`,
      ],
      { cwd: "..", stdio: "pipe" },
    );
  }
});
