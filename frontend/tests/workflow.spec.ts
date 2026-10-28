import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test("注册、登录、共创项目、筛选、会话与权限", async ({ page, request }) => {
  const key = randomUUID().replaceAll("-", "").slice(0, 12),
    username = `owner-${key}`,
    coUsername = `co-${key}`,
    password = "Test-Only-Pass-1023";
  const projectName = "共创验收 " + key;
  try {
    expect((await request.get("/api/v1/projects")).status()).toBe(401);
    expect(
      (
        await request.post("/api/v1/auth/register", {
          headers: { Origin: "https://untrusted.example" },
          data: { name: "非法来源", username, password },
        })
      ).status(),
    ).toBe(403);
    const co = await request.post("/api/v1/auth/register", {
      data: { name: "验收共创者", username: coUsername, password },
    });
    expect(co.status()).toBe(200);
    await page.goto("/");
    await page.getByRole("button", { name: "还没有账号？自行注册" }).click();
    await page.getByLabel("姓名", { exact: true }).fill("验收作者");
    await page.getByLabel("用户名", { exact: true }).fill(username);
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "注册账号", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("注册成功");
    expect(
      (
        await request.post("/api/v1/auth/register", {
          data: { name: "重复", username, password },
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await request.post("/api/v1/auth/login", {
          data: { username, password: "incorrect-password" },
        })
      ).status(),
    ).toBe(401);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByRole("heading", { name: "项目广场" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "项目广场" })).toBeVisible();
    const me = await (await page.request.get("/api/v1/auth/me")).json();
    const cookie = (await page.context().cookies()).find(
      (c) => c.name === "assets_session",
    );
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Strict");
    const payload = {
      name: projectName,
      summary: "验收说明",
      readme: "# 验收标题",
      category: "文档",
      demoEnabled: false,
      collaboratorIds: [],
    };
    expect(
      (await page.request.post("/api/v1/projects", { data: payload })).status(),
    ).toBe(403);
    expect(
      (
        await page.request.post("/api/v1/projects", {
          headers: { "X-CSRF-Token": me.csrfToken },
          data: { ...payload, collaboratorIds: [922337203685477] },
        })
      ).status(),
    ).toBe(400);
    await page
      .getByRole("button", { name: "创建项目", exact: true })
      .first()
      .click();
    const createDropZone = page.locator(".file-drop-zone");
    await createDropZone.evaluate((target) => {
      const file = new File(["内容"], "说明.txt", { type: "text/plain" });
      const fileEntry = {
        isFile: true,
        isDirectory: false,
        fullPath: "/项目资料/说明.txt",
        file: (resolve: (file: File) => void) =>
          window.setTimeout(() => resolve(file), 500),
      };
      const directoryEntry = {
        isFile: false,
        isDirectory: true,
        fullPath: "/项目资料",
        createReader: () => {
          let read = false;
          return {
            readEntries: (resolve: (entries: unknown[]) => void) => {
              resolve(read ? [] : [fileEntry]);
              read = true;
            },
          };
        },
      };
      const drop = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(drop, "dataTransfer", {
        value: {
          items: [{ webkitGetAsEntry: () => directoryEntry }],
          files: [],
        },
      });
      target.dispatchEvent(drop);
    });
    await expect(createDropZone).toContainText("正在读取文件夹");
    await expect(page.getByRole("button", { name: "发布项目" })).toBeDisabled();
    await expect(page.getByText("已添加 1 个文件到待上传列表。")).toBeVisible();
    await expect(
      page.getByText("待上传：1 个文件", { exact: false }),
    ).toBeVisible();
    await expect(page.locator(".file-tree")).toContainText("项目资料");
    await page.getByRole("button", { name: "移除文件夹" }).click();
    await page.getByLabel("项目名称", { exact: true }).fill(projectName);
    await page.getByLabel("项目分类", { exact: true }).selectOption("文档");
    await page.getByLabel("项目简介").fill("跨成员协作与项目查询验收");
    const editor = page.getByLabel("项目说明", { exact: true });
    const fileInput = page.getByLabel("选择 Markdown 文件");
    const markdown =
      "# 验收标题\n\n- 第一项\n- 第二项\n\n<script>alert(1)</script>";
    await fileInput.setInputFiles({
      name: "说明.MD",
      mimeType: "text/markdown",
      buffer: Buffer.from(markdown),
    });
    await expect(editor).toHaveValue(markdown);
    await expect(page.getByRole("status")).toContainText("已导入 说明.MD");
    await fileInput.setInputFiles({
      name: "错误.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("拒绝"),
    });
    await expect(page.getByRole("alert")).toContainText("请选择 .md");
    await expect(editor).toHaveValue(markdown);
    await fileInput.setInputFiles({
      name: "过大.md",
      mimeType: "text/markdown",
      buffer: Buffer.alloc(200001, 65),
    });
    await expect(page.getByRole("alert")).toContainText("不能超过 200 KB");
    await fileInput.setInputFiles({
      name: "空.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("  "),
    });
    await expect(page.getByRole("alert")).toContainText("文件内容为空");
    await fileInput.setInputFiles({
      name: "编码错误.md",
      mimeType: "text/markdown",
      buffer: Buffer.from([255, 254, 65]),
    });
    await expect(page.getByRole("alert")).toContainText("UTF-8");
    await expect(editor).toHaveValue(markdown);
    page.once("dialog", (dialog) => dialog.dismiss());
    await fileInput.setInputFiles({
      name: "替换.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# 新内容"),
    });
    await expect(
      page.getByRole("button", { name: "导入 Markdown", exact: true }),
    ).toBeEnabled();
    await expect(editor).toHaveValue(markdown);
    page.once("dialog", (dialog) => dialog.accept());
    await fileInput.setInputFiles({
      name: "替换.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("\ufeff" + markdown),
    });
    await expect(page.getByRole("status")).toContainText("已导入 替换.md");
    await expect(editor).toHaveValue(markdown);
    await editor.fill(markdown + "\n\n导入后仍可编辑。");
    await page.getByRole("button", { name: "预览 Markdown" }).click();
    await expect(page.getByRole("heading", { name: "验收标题" })).toBeVisible();
    await expect(page.locator(".user-options > button")).toHaveCount(0);
    await page.getByLabel("搜索共创者").fill(`@${coUsername}`);
    await page
      .locator(".user-options > button")
      .filter({ hasText: coUsername })
      .click();
    await page.getByRole("button", { name: "发布项目", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: projectName, exact: true }),
    ).toBeVisible();
    await expect(page.locator("article script")).toHaveCount(0);
    await expect(page.locator("article")).toContainText("导入后仍可编辑。");
    await page.getByRole("button", { name: "编辑项目" }).click();
    await expect(page.getByRole("heading", { name: "编辑项目" })).toBeVisible();
    await page.getByRole("tab", { name: "文件与演示" }).click();
    await page.getByLabel("选择项目文件").setInputFiles([
      {
        name: "原始文档.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("未压缩文件内容"),
      },
      {
        name: "数据.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("name,value\n测试,42"),
      },
    ]);
    await expect(
      page.locator(".file-tree").getByText("待保存", { exact: true }),
    ).toHaveCount(2);
    await expect(page.locator(".file-tree-file")).toHaveCount(2);
    await expect(
      page.locator(".file-tree-file").getByRole("link", { name: "下载" }),
    ).toHaveCount(0);
    await page.screenshot({
      path: "test-results/file-changes-pending.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "保存修改" }).click();
    await expect(
      page.getByRole("heading", { name: projectName, exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "编辑项目" }).click();
    await page.getByRole("tab", { name: "文件与演示" }).click();
    await expect(page.locator(".file-tree-file")).toHaveCount(2);
    const firstFile = page
      .locator(".file-tree-file")
      .filter({ hasText: "原始文档.txt" });
    const downloadURL = await firstFile
      .getByRole("link", { name: "下载" })
      .getAttribute("href");
    expect(await (await page.request.get(downloadURL!)).text()).toBe(
      "未压缩文件内容",
    );
    await firstFile
      .getByRole("button", { name: "删除文件", exact: true })
      .click();
    await expect(firstFile).toContainText("待删除");
    expect((await page.request.get(downloadURL!)).status()).toBe(200);
    await page.getByRole("button", { name: "保存修改" }).click();
    await expect(
      page.getByRole("heading", { name: projectName, exact: true }),
    ).toBeVisible();
    expect((await page.request.get(downloadURL!)).status()).toBe(404);
    await page.getByRole("button", { name: "编辑项目" }).click();
    await page.getByRole("tab", { name: "文件与演示" }).click();
    const dropZone = page.locator(".file-drop-zone");
    await expect(dropZone).toContainText("拖入文件或整个文件夹");
    await dropZone.evaluate((target) => {
      const nestedFile = new File(["folder-content"], "嵌套文件.txt", {
        type: "text/plain",
      });
      const fileEntry = {
        isFile: true,
        isDirectory: false,
        fullPath: "/资料/子目录/嵌套文件.txt",
        file: (success: (file: File) => void) => success(nestedFile),
      };
      const directoryEntry = {
        isFile: false,
        isDirectory: true,
        fullPath: "/资料",
        createReader: () => {
          let read = false;
          return {
            readEntries: (success: (entries: unknown[]) => void) => {
              success(read ? [] : [fileEntry]);
              read = true;
            },
          };
        },
      };
      const drop = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(drop, "dataTransfer", {
        value: {
          items: [{ webkitGetAsEntry: () => directoryEntry }],
          files: [],
        },
      });
      target.dispatchEvent(drop);
    });
    const topFolder = page
      .locator(".file-tree-folder > details")
      .filter({ has: page.getByText("资料", { exact: true }) })
      .first();
    await expect(topFolder.locator(":scope > summary")).toContainText(
      "1 个文件",
    );
    await topFolder.locator(":scope > summary").click();
    await page
      .locator(".file-tree-folder > details > summary")
      .filter({ hasText: "子目录" })
      .click();
    await expect(
      page.locator(".file-tree-file").filter({ hasText: "嵌套文件.txt" }),
    ).toContainText("待保存");
    await page.getByRole("button", { name: "保存修改" }).click();
    await expect(
      page.getByRole("heading", { name: projectName, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "编辑项目" }).click();
    await page.getByRole("tab", { name: "文件与演示" }).click();
    const savedTopFolder = page
      .locator(".file-tree-folder > details")
      .filter({ has: page.getByText("资料", { exact: true }) })
      .first();
    await expect(savedTopFolder.locator(":scope > summary")).toContainText(
      "1 个文件",
      { timeout: 15_000 },
    );
    const projectList = await (
      await page.request.get(
        `/api/v1/projects?q=${encodeURIComponent(projectName)}&page=1`,
      )
    ).json();
    const savedProject = projectList.items.find(
      (item: { name: string }) => item.name === projectName,
    );
    expect(savedProject).toBeTruthy();
    await expect(
      savedTopFolder.getByRole("link", { name: "下载", exact: true }),
    ).toHaveAttribute(
      "href",
      `/api/v1/projects/${savedProject.id}/files/download-folder?folder=${encodeURIComponent("资料")}`,
    );
    await savedTopFolder
      .getByRole("button", { name: "删除文件夹", exact: true })
      .click();
    await expect(
      savedTopFolder.getByRole("button", {
        name: "撤销删除文件夹",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "保存修改" })).toBeEnabled();
    await savedTopFolder
      .getByRole("button", { name: "撤销删除文件夹", exact: true })
      .click();
    await expect(page.getByRole("button", { name: "保存修改" })).toBeDisabled();
    const nestedFile = page
      .locator(".file-tree-file")
      .filter({ hasText: "嵌套文件.txt" });
    await expect(nestedFile).toBeHidden();
    await savedTopFolder.locator(":scope > summary").click();
    await page
      .locator(".file-tree-folder > details > summary")
      .filter({ hasText: "子目录" })
      .click();
    await expect(nestedFile).toBeVisible();
    await savedTopFolder.locator(":scope > summary").click();
    await page.screenshot({
      path: "test-results/project-detail.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "返回项目" }).click();
    await page.getByRole("button", { name: "返回项目列表" }).click();
    await page.getByLabel("搜索项目").fill(key);
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(
      page.getByRole("button", { name: projectName, exact: true }),
    ).toBeVisible();
    await page.getByLabel("项目分类", { exact: true }).selectOption("软件");
    await expect(
      page.getByRole("heading", { name: "没有找到匹配的项目" }),
    ).toBeVisible();
    await page.getByLabel("项目分类", { exact: true }).selectOption("文档");
    await expect(
      page.getByRole("button", { name: projectName, exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/project-list.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "退出登录" }).click();
    await expect(
      page.getByRole("heading", { name: "登录工作空间" }),
    ).toBeVisible();
    expect((await page.request.get("/api/v1/projects")).status()).toBe(401);
    const replay = await request.get("/api/v1/auth/me", {
      headers: { Cookie: `assets_session=${cookie?.value}` },
    });
    expect(replay.status()).toBe(401);
    await page.getByLabel("用户名", { exact: true }).fill(coUsername);
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.getByRole("button", { name: "我的项目", exact: true }).click();
    await expect(
      page.getByRole("button", { name: projectName, exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  } finally {
    // Only remove this test's UUID-scoped accounts and their projects; never user data.
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
        `BEGIN; DELETE FROM projects WHERE author_id IN (SELECT id FROM users WHERE username IN ('${username}','${coUsername}')); DELETE FROM users WHERE username IN ('${username}','${coUsername}'); COMMIT;`,
      ],
      { cwd: "..", stdio: "pipe" },
    );
  }
});
