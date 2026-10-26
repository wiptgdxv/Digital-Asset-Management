import { expect, request as requestFactory, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test("协同编辑、版本冲突与共创者权限", async ({ page, request }) => {
  const key = randomUUID().replaceAll("-", "").slice(0, 12);
  const password = "Test-Only-Pass-1023";
  const ownerUsername = `edit-owner-${key}`;
  const coUsername = `edit-co-${key}`;
  const nextUsername = `edit-next-${key}`;
  const baseURL = "http://127.0.0.1:5173";
  const accounts = [
    { name: "协同作者", username: ownerUsername },
    { name: "原共创者", username: coUsername },
    { name: "新共创者", username: nextUsername },
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

    const [ownerApi, coApi, nextApi] = contexts;
    const ownerMe = await (await ownerApi.get("/api/v1/auth/me")).json();
    const coMe = await (await coApi.get("/api/v1/auth/me")).json();
    const nextMe = await (await nextApi.get("/api/v1/auth/me")).json();
    const createdResponse = await ownerApi.post("/api/v1/projects", {
      headers: { "X-CSRF-Token": ownerMe.csrfToken },
      data: {
        name: "协同编辑验收 " + key,
        summary: "初始简介",
        readme: "# 初始说明",
        category: "软件",
        demoEnabled: false,
        collaboratorIds: [coMe.user.id],
      },
    });
    expect(createdResponse.status()).toBe(200);
    const created = await createdResponse.json();
    expect(created.version).toBe(1);

    const collaboratorEdit = await coApi.put(`/api/v1/projects/${created.id}`, {
      headers: { "X-CSRF-Token": coMe.csrfToken },
      data: {
        version: created.version,
        name: created.name,
        summary: "由共创者修改",
        readme: created.readme,
        category: created.category,
        demoEnabled: false,
        collaboratorIds: [coMe.user.id],
      },
    });
    expect(collaboratorEdit.status()).toBe(200);
    const afterCollaboratorEdit = await collaboratorEdit.json();
    expect(afterCollaboratorEdit.version).toBe(2);
    expect(afterCollaboratorEdit.lastEditor.id).toBe(coMe.user.id);

    const staleSave = await ownerApi.put(`/api/v1/projects/${created.id}`, {
      headers: { "X-CSRF-Token": ownerMe.csrfToken },
      data: {
        version: created.version,
        name: created.name,
        summary: "过期修改",
        readme: created.readme,
        category: created.category,
        demoEnabled: false,
        collaboratorIds: [coMe.user.id],
      },
    });
    expect(staleSave.status()).toBe(409);

    const forbiddenMembers = await coApi.put(`/api/v1/projects/${created.id}`, {
      headers: { "X-CSRF-Token": coMe.csrfToken },
      data: {
        version: afterCollaboratorEdit.version,
        name: created.name,
        summary: "尝试更改成员",
        readme: created.readme,
        category: created.category,
        demoEnabled: false,
        collaboratorIds: [nextMe.user.id],
      },
    });
    expect(forbiddenMembers.status()).toBe(403);

    const memberChange = await ownerApi.put(`/api/v1/projects/${created.id}`, {
      headers: { "X-CSRF-Token": ownerMe.csrfToken },
      data: {
        version: afterCollaboratorEdit.version,
        name: created.name,
        summary: afterCollaboratorEdit.summary,
        readme: created.readme,
        category: created.category,
        demoEnabled: false,
        collaboratorIds: [nextMe.user.id],
      },
    });
    expect(memberChange.status()).toBe(200);
    const afterMemberChange = await memberChange.json();
    expect(
      afterMemberChange.collaborators.map((user: { id: number }) => user.id),
    ).toEqual([nextMe.user.id]);

    const oldMine = await (
      await coApi.get("/api/v1/projects?scope=mine&page=1")
    ).json();
    expect(
      oldMine.items.some(
        (project: { id: number }) => project.id === created.id,
      ),
    ).toBe(false);
    const nextMine = await (
      await nextApi.get("/api/v1/projects?scope=mine&page=1")
    ).json();
    expect(
      nextMine.items.some(
        (project: { id: number }) => project.id === created.id,
      ),
    ).toBe(true);

    await page.goto("/");
    await page.getByLabel("用户名", { exact: true }).fill(ownerUsername);
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.getByLabel("搜索项目").fill(key);
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await page.getByRole("button", { name: created.name, exact: true }).click();
    await page.getByRole("button", { name: "编辑项目" }).click();
    await expect(page.getByRole("heading", { name: "编辑项目" })).toBeVisible();
    await page.getByRole("tab", { name: "协作成员" }).click();
    await expect(page.getByText("新共创者 · 移除")).toBeVisible();
    await page.getByRole("tab", { name: "项目资料" }).click();
    await page.getByLabel("项目简介").fill("作者尚未保存的草稿");

    const externalSave = await nextApi.put(`/api/v1/projects/${created.id}`, {
      headers: { "X-CSRF-Token": nextMe.csrfToken },
      data: {
        version: afterMemberChange.version,
        name: created.name,
        summary: "其他员工刚刚保存的内容",
        readme: created.readme,
        category: created.category,
        demoEnabled: false,
        collaboratorIds: [nextMe.user.id],
      },
    });
    expect(externalSave.status()).toBe(200);
    await page.getByRole("button", { name: "保存修改" }).click();
    await expect(page.getByRole("alert")).toContainText("发现更新冲突");
    await expect(page.getByLabel("项目简介")).toHaveValue("作者尚未保存的草稿");
    await page.screenshot({
      path: "test-results/project-edit-conflict.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "重新加载最新版本" }).click();
    await expect(page.getByLabel("项目简介")).toHaveValue(
      "其他员工刚刚保存的内容",
    );
    await expect(page.getByText("当前版本 4")).toBeVisible();
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
        `BEGIN; DELETE FROM projects WHERE author_id IN (SELECT id FROM users WHERE username IN ('${ownerUsername}','${coUsername}','${nextUsername}')); DELETE FROM users WHERE username IN ('${ownerUsername}','${coUsername}','${nextUsername}'); COMMIT;`,
      ],
      { cwd: "..", stdio: "pipe" },
    );
  }
});
