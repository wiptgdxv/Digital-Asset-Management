import { expect, request as requestFactory, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test("项目评论、回复、权限与修改时间隔离", async ({ page, request }) => {
  const key = randomUUID().replaceAll("-", "").slice(0, 12);
  const password = "Test-Only-Pass-1023";
  const ownerUsername = `comment-owner-${key}`;
  const commenterUsername = `comment-user-${key}`;
  const strangerUsername = `comment-stranger-${key}`;
  const baseURL = "http://127.0.0.1:5173";
  const accounts = [
    { name: "评论项目作者", username: ownerUsername },
    { name: "评论员工", username: commenterUsername },
    { name: "其他员工", username: strangerUsername },
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

    const [ownerApi, commenterApi, strangerApi] = contexts;
    const ownerMe = await (await ownerApi.get("/api/v1/auth/me")).json();
    const commenterMe = await (
      await commenterApi.get("/api/v1/auth/me")
    ).json();
    const strangerMe = await (await strangerApi.get("/api/v1/auth/me")).json();
    const projectResponse = await ownerApi.post("/api/v1/projects", {
      headers: { "X-CSRF-Token": ownerMe.csrfToken },
      data: {
        name: "评论验收 " + key,
        summary: "验证评论不会改变项目修改时间",
        readme: "# 评论验收",
        category: "文档",
        demoEnabled: false,
        collaboratorIds: [],
      },
    });
    expect(projectResponse.status()).toBe(200);
    const project = await projectResponse.json();

    expect(
      (
        await commenterApi.post(`/api/v1/projects/${project.id}/comments`, {
          data: { content: "缺少 CSRF" },
        })
      ).status(),
    ).toBe(403);

    const commentResponse = await commenterApi.post(
      `/api/v1/projects/${project.id}/comments`,
      {
        headers: { "X-CSRF-Token": commenterMe.csrfToken },
        data: {
          content: `请 @${ownerUsername} 查看，重复 @${ownerUsername}，忽略自己 @${commenterUsername} 和未知 @missing-${key}`,
        },
      },
    );
    expect(commentResponse.status()).toBe(200);
    const comment = await commentResponse.json();
    expect(comment.replies).toEqual([]);
    expect(comment.content).toContain(`@${ownerUsername}`);

    const ownerNotifications = await (
      await ownerApi.get("/api/v1/notifications")
    ).json();
    expect(ownerNotifications.unread).toBe(1);
    expect(ownerNotifications.items).toHaveLength(1);
    expect(ownerNotifications.items[0].projectId).toBe(project.id);
    expect(ownerNotifications.items[0].actor.username).toBe(commenterUsername);
    expect(
      (await commenterApi.get("/api/v1/notifications")).json(),
    ).resolves.toMatchObject({ unread: 0, items: [] });

    const afterComment = await (
      await ownerApi.get(`/api/v1/projects/${project.id}`)
    ).json();
    expect(afterComment.updatedAt).toBe(project.updatedAt);
    expect(afterComment.version).toBe(project.version);

    const replyResponse = await strangerApi.post(
      `/api/v1/comments/${comment.id}/replies`,
      {
        headers: { "X-CSRF-Token": strangerMe.csrfToken },
        data: { content: `第一条回复，请 @${commenterUsername} 确认` },
      },
    );
    expect(replyResponse.status()).toBe(200);
    const reply = await replyResponse.json();
    const commenterNotifications = await (
      await commenterApi.get("/api/v1/notifications")
    ).json();
    expect(commenterNotifications.unread).toBe(1);
    expect(commenterNotifications.items[0].commentId).toBe(reply.id);
    expect(commenterNotifications.items[0].actor.username).toBe(
      strangerUsername,
    );
    expect(
      (
        await ownerApi.post("/api/v1/notifications/read", {
          headers: { "X-CSRF-Token": ownerMe.csrfToken },
        })
      ).status(),
    ).toBe(200);
    const readOwnerNotifications = await (
      await ownerApi.get("/api/v1/notifications")
    ).json();
    expect(readOwnerNotifications.unread).toBe(0);
    expect(readOwnerNotifications.items[0].isRead).toBe(true);
    expect(
      (
        await strangerApi.post(`/api/v1/comments/${reply.id}/replies`, {
          headers: { "X-CSRF-Token": strangerMe.csrfToken },
          data: { content: "不允许嵌套回复" },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await strangerApi.delete(`/api/v1/comments/${reply.id}`, {
          headers: { "X-CSRF-Token": strangerMe.csrfToken },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await strangerApi.delete(`/api/v1/comments/${comment.id}`, {
          headers: { "X-CSRF-Token": strangerMe.csrfToken },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await commenterApi.post(`/api/v1/projects/${project.id}/comments`, {
          headers: { "X-CSRF-Token": commenterMe.csrfToken },
          data: { content: "   " },
        })
      ).status(),
    ).toBe(400);

    const listed = await (
      await ownerApi.get(`/api/v1/projects/${project.id}/comments`)
    ).json();
    expect(listed.items).toHaveLength(1);
    expect(
      listed.items[0].replies.map((item: { id: number }) => item.id),
    ).toEqual([reply.id]);

    await page.goto("/");
    await page.getByLabel("用户名", { exact: true }).fill(commenterUsername);
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByLabel("1 条未读提醒")).toBeVisible();
    await page.getByRole("button", { name: /提醒/ }).click();
    await page.screenshot({
      path: "test-results/notification-list.png",
      fullPage: true,
    });
    await page
      .locator(".notification-item")
      .filter({ hasText: project.name })
      .click();
    await expect(
      page.getByRole("heading", { name: "评论与回复" }),
    ).toBeVisible();
    await expect(page.locator(".comment-list")).toBeVisible();
    await expect(page.getByLabel("发表评论")).toBeVisible();
    await expect(page.getByRole("button", { name: "展开评论" })).toHaveCount(0);
    const existingComment = page
      .locator(".comment-item")
      .filter({ hasText: "请 @" });
    const targetedReply = existingComment
      .locator(".reply-item.is-targeted")
      .filter({ hasText: "第一条回复" });
    await expect(targetedReply).toBeVisible();
    await page.screenshot({
      path: "test-results/notification-comment-target.png",
      fullPage: true,
    });
    await existingComment.getByRole("button", { name: "收起回复" }).click();
    await expect(existingComment.getByText("第一条回复")).toHaveCount(0);
    await existingComment
      .getByRole("button", { name: "展开 1 条回复" })
      .click();
    await expect(existingComment.getByText(/第一条回复/)).toBeVisible();
    await existingComment
      .locator(".reply-item")
      .getByRole("button", { name: "回复", exact: true })
      .click();
    await expect(existingComment.getByLabel("回复评论")).toHaveValue(
      `@${strangerUsername} `,
    );
    await existingComment.getByRole("button", { name: "取消" }).click();
    await existingComment.getByRole("button", { name: "收起回复" }).click();
    await expect(existingComment.getByText("第一条回复")).toHaveCount(0);
    await expect(
      page.locator(".mention").filter({ hasText: ownerUsername }).first(),
    ).toBeVisible();
    const commentInput = page.getByLabel("发表评论");
    await commentInput.fill("页面新评论，请 @评论项目");
    const ownerOption = page
      .getByRole("option")
      .filter({ hasText: ownerUsername });
    await expect(ownerOption).toContainText("评论项目作者");
    await page.screenshot({
      path: "test-results/mention-autocomplete.png",
      fullPage: true,
    });
    await ownerOption.click();
    await expect(commentInput).toHaveValue(`页面新评论，请 @${ownerUsername} `);
    await commentInput.pressSequentially("处理一下文件");
    await page.getByRole("button", { name: "发表评论", exact: true }).click();
    const uiComment = page
      .locator(".comment-item")
      .filter({ hasText: "页面新评论" });
    await expect(uiComment).toBeVisible();
    await expect
      .poll(async () => {
        const notifications = await (
          await ownerApi.get("/api/v1/notifications")
        ).json();
        return notifications.unread;
      })
      .toBe(1);
    await uiComment.getByRole("button", { name: "回复", exact: true }).click();
    const replyInput = uiComment.getByLabel("回复评论");
    await replyInput.fill("页面即时回复，请 @其他");
    await expect(
      page.getByRole("option").filter({ hasText: strangerUsername }),
    ).toBeVisible();
    await replyInput.press("Enter");
    await expect(replyInput).toHaveValue(
      `页面即时回复，请 @${strangerUsername} `,
    );
    await replyInput.pressSequentially("确认");
    await uiComment.getByRole("button", { name: "提交回复" }).click();
    await expect(uiComment).toContainText("页面即时回复");
    await expect
      .poll(async () => {
        const notifications = await (
          await strangerApi.get("/api/v1/notifications")
        ).json();
        return notifications.unread;
      })
      .toBe(1);
    await page.screenshot({
      path: "test-results/comments.png",
      fullPage: true,
    });
    await expect(page.getByRole("button", { name: /删除.*评论/ })).toHaveCount(
      0,
    );

    expect(
      (
        await commenterApi.delete(`/api/v1/comments/${comment.id}`, {
          headers: { "X-CSRF-Token": commenterMe.csrfToken },
        })
      ).status(),
    ).toBe(404);
    const unchanged = await (
      await ownerApi.get(`/api/v1/projects/${project.id}/comments`)
    ).json();
    expect(unchanged.items).toHaveLength(2);
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
        `BEGIN; DELETE FROM projects WHERE author_id IN (SELECT id FROM users WHERE username IN ('${ownerUsername}','${commenterUsername}','${strangerUsername}')); DELETE FROM users WHERE username IN ('${ownerUsername}','${commenterUsername}','${strangerUsername}'); COMMIT;`,
      ],
      { cwd: "..", stdio: "pipe" },
    );
  }
});
