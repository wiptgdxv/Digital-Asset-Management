import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

const baseURL = process.env.CHAT_E2E_URL;
test.skip(!baseURL, "Set CHAT_E2E_URL to the isolated chat test server");
test.use({ baseURL });

test("项目群实时消息、私聊和附件权限", async ({ page, browser, request }) => {
  const key = randomUUID().replaceAll("-", "").slice(0, 12);
  const owner = `chatowner-${key}`,
    member = `chatmember-${key}`,
    outsider = `chatoutside-${key}`;
  const password = "Test-Only-Pass-1023";
  for (const username of [owner, member, outsider]) {
    const res = await request.post("/api/v1/auth/register", {
      data: { name: username, username, password },
    });
    expect(res.status()).toBe(200);
  }
  async function login(target: typeof page, username: string) {
    await target.goto("/");
    await target.getByLabel("用户名", { exact: true }).fill(username);
    await target.getByLabel("密码", { exact: true }).fill(password);
    await target.getByRole("button", { name: "登录", exact: true }).click();
    await expect(
      target.getByRole("heading", { name: "项目广场" }),
    ).toBeVisible();
  }
  await login(page, owner);
  const ownerSession = await (await page.request.get("/api/v1/auth/me")).json();
  const userList = await (
    await page.request.get(`/api/v1/users?q=${member}`)
  ).json();
  const memberId = userList.items.find(
    (user: { username: string }) => user.username === member,
  ).id;
  const projectName = `聊天验收 ${key}`;
  const projectResponse = await page.request.post("/api/v1/projects", {
    headers: { "X-CSRF-Token": ownerSession.csrfToken },
    data: {
      name: projectName,
      summary: "",
      readme: "",
      category: "其他",
      demoEnabled: false,
      collaboratorIds: [memberId],
    },
  });
  expect(projectResponse.status()).toBe(200);
  const project = await projectResponse.json();
  const memberPage = await browser.newPage({ baseURL });
  try {
    await login(memberPage, member);
    await page.reload();
    await page.getByRole("button", { name: projectName, exact: true }).click();
    await page.getByRole("button", { name: "项目群聊" }).click();
    await expect(page.locator(".chat-conversation-heading")).toContainText(
      projectName,
    );
    await memberPage.getByRole("button", { name: "消息", exact: true }).click();
    await memberPage
      .locator(".chat-list button")
      .filter({ hasText: projectName })
      .click();
    await page.getByLabel("消息内容").fill("项目群实时消息");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(
      memberPage.getByText("项目群实时消息", { exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await memberPage
      .locator(".chat-message")
      .filter({ hasText: "项目群实时消息" })
      .getByRole("button", { name: "回复" })
      .click();
    await memberPage.getByLabel("消息内容").fill("引用回复内容");
    await memberPage.getByRole("button", { name: "发送", exact: true }).click();
    const reply = page
      .locator(".chat-message")
      .filter({ hasText: "引用回复内容" });
    await expect(reply).toBeVisible({ timeout: 15000 });
    await expect(reply.locator(".chat-quoted")).toContainText("项目群实时消息");
    await page.getByRole("button", { name: "项目广场" }).click();
    await memberPage.getByLabel("消息内容").fill(`请 @${owner.slice(0, 12)}`);
    await memberPage.getByRole("option").filter({ hasText: owner }).click();
    await memberPage.getByLabel("消息内容").pressSequentially("查看资料");
    await memberPage.getByRole("button", { name: "发送", exact: true }).click();
    await expect
      .poll(async () => {
        const chats = await (
          await page.request.get("/api/v1/chat/conversations")
        ).json();
        return chats.items.find(
          (item: { projectId: number }) => item.projectId === project.id,
        )?.mentions;
      })
      .toBe(1);
    await page.getByRole("button", { name: /^消息/ }).click();
    await expect(
      page.getByText(`请 @${owner} 查看资料`, { exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await page.getByLabel("选择聊天文件").setInputFiles({
      name: "内部资料.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("internal content"),
    });
    await expect(
      memberPage.getByText("内部资料.txt", { exact: true }),
    ).toBeVisible({ timeout: 15000 });
    const attachment = memberPage
      .locator(".chat-message")
      .filter({ hasText: "内部资料.txt" });
    const url = await attachment
      .getByRole("link", { name: "下载", exact: true })
      .getAttribute("href");
    expect(await (await memberPage.request.get(url!)).text()).toBe(
      "internal content",
    );
    await page.locator(".chat-conversation").evaluate((target) => {
      const file = new File(["folder body"], "nested.txt", {
        type: "text/plain",
      });
      const entry = {
        isFile: true,
        isDirectory: false,
        fullPath: "/资料/子目录/nested.txt",
        file: (resolve: (file: File) => void) => resolve(file),
      };
      const secondFile = new File(["second body"], "nested2.txt", {
        type: "text/plain",
      });
      const secondEntry = {
        isFile: true,
        isDirectory: false,
        fullPath: "/资料/子目录/nested2.txt",
        file: (resolve: (file: File) => void) => resolve(secondFile),
      };
      const directory = {
        isFile: false,
        isDirectory: true,
        fullPath: "/资料",
        createReader: () => {
          let read = false;
          return {
            readEntries: (resolve: (entries: unknown[]) => void) => {
              resolve(read ? [] : [entry, secondEntry]);
              read = true;
            },
          };
        },
      };
      const drop = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(drop, "dataTransfer", {
        value: { items: [{ webkitGetAsEntry: () => directory }], files: [] },
      });
      target.dispatchEvent(drop);
    });
    const folderMessage = memberPage
      .locator(".chat-message")
      .filter({ hasText: "nested.txt" });
    await expect(folderMessage).toBeVisible({ timeout: 15000 });
    await expect(folderMessage).toContainText("本批次已接收 2/2 个文件", {
      timeout: 15000,
    });
    const folderURL = await folderMessage
      .getByRole("link", { name: "下载文件夹" })
      .getAttribute("href");
    const archive = await memberPage.request.get(folderURL!);
    expect(archive.status()).toBe(200);
    expect(archive.headers()["content-type"]).toContain("application/zip");
    const archiveBody = await archive.body();
    expect(archiveBody.includes(Buffer.from("folder body"))).toBe(true);
    expect(archiveBody.includes(Buffer.from("second body"))).toBe(true);
    const multiChunkFile = Buffer.alloc(20 * 1024 * 1024, 0x5a);
    await page.getByLabel("选择聊天文件").setInputFiles({
      name: "多分片资料.bin",
      mimeType: "application/octet-stream",
      buffer: multiChunkFile,
    });
    await page.getByRole("button", { name: "项目广场" }).click();
    const multiChunkMessage = memberPage
      .locator(".chat-message")
      .filter({ hasText: "多分片资料.bin" });
    await expect(multiChunkMessage).toBeVisible({ timeout: 30000 });
    const multiChunkURL = await multiChunkMessage
      .getByRole("link", { name: "下载", exact: true })
      .getAttribute("href");
    expect(await (await memberPage.request.get(multiChunkURL!)).body()).toEqual(
      multiChunkFile,
    );
    await page.getByRole("button", { name: /^消息/ }).click();
    await memberPage.getByRole("button", { name: "聊天文件" }).click();
    await expect(
      memberPage.getByText("项目群实时消息", { exact: true }),
    ).toHaveCount(0);
    await memberPage.getByLabel("搜索聊天记录").fill("nested");
    await memberPage.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(folderMessage).toBeVisible();
    await expect(
      memberPage.getByText("内部资料.txt", { exact: true }),
    ).toHaveCount(0);
    await memberPage.getByRole("button", { name: "清除", exact: true }).click();
    await expect(
      memberPage.getByText("项目群实时消息", { exact: true }),
    ).toBeVisible();
    const outsiderContext = await browser.newContext({ baseURL });
    try {
      const loginResponse = await outsiderContext.request.post(
        "/api/v1/auth/login",
        { data: { username: outsider, password } },
      );
      expect(loginResponse.status()).toBe(200);
      expect((await outsiderContext.request.get(url!)).status()).toBe(404);
    } finally {
      await outsiderContext.close();
    }
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .locator(".chat-message")
      .filter({ hasText: "内部资料.txt" })
      .getByRole("button", { name: "撤回" })
      .click();
    await expect(
      memberPage.getByText("内部资料.txt", { exact: true }),
    ).toHaveCount(0);
    expect((await memberPage.request.get(url!)).status()).toBe(404);
    await memberPage.screenshot({
      path: "test-results/chat-project.png",
      fullPage: true,
    });

    const changed = await page.request.put(`/api/v1/projects/${project.id}`, {
      headers: { "X-CSRF-Token": ownerSession.csrfToken },
      data: {
        name: project.name,
        summary: project.summary,
        readme: project.readme,
        category: project.category,
        demoEnabled: project.demoEnabled,
        version: project.version,
        collaboratorIds: [],
      },
    });
    expect(changed.status()).toBe(200);
    await expect(
      memberPage.locator(".chat-list button").filter({ hasText: projectName }),
    ).toHaveCount(0, { timeout: 15000 });
    const updatedProject = await changed.json();
    const readded = await page.request.put(`/api/v1/projects/${project.id}`, {
      headers: { "X-CSRF-Token": ownerSession.csrfToken },
      data: {
        name: project.name,
        summary: project.summary,
        readme: project.readme,
        category: project.category,
        demoEnabled: project.demoEnabled,
        version: updatedProject.version,
        collaboratorIds: [memberId],
      },
    });
    expect(readded.status()).toBe(200);
    await memberPage
      .locator(".chat-list button")
      .filter({ hasText: projectName })
      .click({ timeout: 15000 });
    await expect(
      memberPage.getByText("项目群实时消息", { exact: true }),
    ).toHaveCount(0);
    expect((await memberPage.request.get(folderURL!)).status()).toBe(404);

    await memberPage.getByLabel("发起私聊").fill(owner);
    await memberPage
      .locator(".chat-user-results button")
      .filter({ hasText: owner })
      .click();
    await memberPage.getByLabel("消息内容").fill("仅双方可见的私聊");
    await memberPage.getByRole("button", { name: "发送", exact: true }).click();
    await page
      .locator(".chat-list button")
      .filter({ hasText: member })
      .click({ timeout: 15000 });
    await expect(
      page.getByText("仅双方可见的私聊", { exact: true }),
    ).toBeVisible();
    const chats = await (
      await page.request.get("/api/v1/chat/conversations")
    ).json();
    const privateChat = chats.items.find(
      (item: { kind: string }) => item.kind === "direct",
    );
    const superContext = await browser.newContext({ baseURL });
    try {
      const register = await superContext.request.post(
        "/api/v1/auth/register",
        { data: { name: "超级管理员", username: "admin", password } },
      );
      expect([200, 409]).toContain(register.status());
      const loginResponse = await superContext.request.post(
        "/api/v1/auth/login",
        { data: { username: "admin", password } },
      );
      expect(loginResponse.status()).toBe(200);
      const adminChats = await (
        await superContext.request.get("/api/v1/chat/conversations")
      ).json();
      const adminProjectChat = adminChats.items.find(
        (item: { projectId: number }) => item.projectId === project.id,
      );
      expect(adminProjectChat).toBeTruthy();
      expect(
        (
          await superContext.request.get(
            `/api/v1/chat/conversations/${adminProjectChat.id}/messages`,
          )
        ).status(),
      ).toBe(200);
      expect(
        (
          await superContext.request.get(
            `/api/v1/chat/conversations/${privateChat.id}/messages`,
          )
        ).status(),
      ).toBe(404);
    } finally {
      await superContext.close();
    }
  } finally {
    await memberPage.context().close();
  }
});
