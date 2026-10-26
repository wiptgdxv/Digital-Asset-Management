import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

test("详情分区导航、本地草稿与同名项目提醒", async ({ page }) => {
  const key = randomUUID().replaceAll("-", "").slice(0, 12);
  const username = `ux-${key}`;
  const password = "Test-Only-Pass-1023";
  const projectName = `体验验收 ${key}`;
  try {
    expect(
      (
        await page.request.post("/api/v1/auth/register", {
          data: { name: "体验验收", username, password },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await page.request.post("/api/v1/auth/login", {
          data: { username, password },
        })
      ).status(),
    ).toBe(200);
    const csrf = (await (await page.request.get("/api/v1/auth/me")).json())
      .csrfToken;
    const project = await (
      await page.request.post("/api/v1/projects", {
        headers: { "X-CSRF-Token": csrf },
        data: {
          name: projectName,
          summary: "原始简介",
          readme: "# 项目说明\n\n用于体验验收。",
          category: "其他",
          demoEnabled: false,
          collaboratorIds: [],
        },
      })
    ).json();

    await page.goto("/");
    await page
      .getByRole("button", { name: "创建项目", exact: true })
      .first()
      .click();
    await page.getByLabel("项目名称", { exact: true }).fill(projectName);
    await page.getByLabel("项目简介").fill("尚未发布的简介");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "返回列表" }).click();

    await page
      .getByRole("button", { name: "创建项目", exact: true })
      .first()
      .click();
    await expect(page.getByText("发现未发布草稿")).toBeVisible();
    await page.getByRole("button", { name: "恢复草稿" }).click();
    await expect(page.getByLabel("项目名称", { exact: true })).toHaveValue(
      projectName,
    );
    await expect(page.getByLabel("项目简介")).toHaveValue("尚未发布的简介");

    let duplicateMessage = "";
    page.once("dialog", async (dialog) => {
      duplicateMessage = dialog.message();
      await dialog.dismiss();
    });
    await page.getByRole("button", { name: "发布项目" }).click();
    await expect(page.getByRole("heading", { name: "创建项目" })).toBeVisible();
    expect(duplicateMessage).toContain("已存在 1 个同名项目");

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "返回列表" }).click();
    await page.getByRole("button", { name: projectName }).click();
    const navigation = page.getByRole("navigation", { name: "项目内容导航" });
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole("button")).toHaveText([
      "项目说明",
      "项目文件",
      "评论",
      "编辑历史",
    ]);
    await page.screenshot({
      path: "test-results/priority-detail-navigation.png",
      fullPage: true,
    });
    await navigation.getByRole("button", { name: "项目文件" }).click();
    await expect(page.locator("#project-files")).toBeInViewport();

    await page.getByRole("button", { name: "编辑项目" }).click();
    await page.getByLabel("项目简介").fill("自动保存的编辑草稿");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "返回项目" }).click();
    await page.getByRole("button", { name: "编辑项目" }).click();
    await expect(page.getByText("发现本地草稿")).toBeVisible();
    await page.getByRole("button", { name: "恢复草稿" }).click();
    await expect(page.getByLabel("项目简介")).toHaveValue("自动保存的编辑草稿");
    await page.screenshot({
      path: "test-results/priority-draft-restored.png",
      fullPage: true,
    });
  } finally {
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
        `BEGIN; DELETE FROM projects WHERE author_id IN (SELECT id FROM users WHERE username='${username}'); DELETE FROM users WHERE username='${username}'; COMMIT;`,
      ],
      { cwd: "..", stdio: "pipe" },
    );
  }
});
