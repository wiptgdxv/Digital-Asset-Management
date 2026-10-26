import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

test("演示材料与项目文件隔离，并仅预览安全格式", async ({ page }) => {
  const key = randomUUID().replaceAll("-", "").slice(0, 12),
    username = `demo-${key}`,
    password = "Test-Only-Pass-1023";
  try {
    expect(
      (
        await page.request.post("/api/v1/auth/register", {
          data: { name: "演示验收", username, password },
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
        .csrfToken,
      headers = { "X-CSRF-Token": csrf, "Tus-Resumable": "1.0.0" };
    const project = await (
      await page.request.post("/api/v1/projects", {
        headers,
        data: {
          name: "演示材料验收 " + key,
          summary: "演示材料隔离与预览",
          readme: "# 演示材料验收",
          category: "设计",
          demoEnabled: true,
          collaboratorIds: [],
        },
      })
    ).json();
    const disabled = await (
      await page.request.post("/api/v1/projects", {
        headers,
        data: {
          name: "禁用演示 " + key,
          summary: "",
          readme: "",
          category: "其他",
          demoEnabled: false,
          collaboratorIds: [],
        },
      })
    ).json();

    function metadata(
      projectId: number,
      name: string,
      kind: "project" | "demo",
      replaceId = 0,
    ) {
      return Object.entries({
        filename: name,
        projectId: String(projectId),
        replaceId: String(replaceId),
        kind,
      })
        .map(
          ([name, value]) => `${name} ${Buffer.from(value).toString("base64")}`,
        )
        .join(",");
    }
    async function upload(
      projectId: number,
      name: string,
      kind: "project" | "demo",
      data: Buffer,
      replaceId = 0,
    ) {
      const created = await page.request.post("/api/v1/uploads", {
        headers: {
          ...headers,
          "Upload-Length": String(data.length),
          "Upload-Metadata": metadata(projectId, name, kind, replaceId),
        },
      });
      expect(created.status()).toBe(201);
      const url = created.headers().location;
      expect(
        (
          await page.request.patch(url, {
            headers: {
              ...headers,
              "Upload-Offset": "0",
              "Content-Type": "application/offset+octet-stream",
            },
            data,
          })
        ).status(),
      ).toBe(204);
      const complete = await page.request.post(
        `/api/v1/uploads/${url.split("/").pop()}/complete`,
        { headers },
      );
      expect(complete.status()).toBe(200);
      return complete.json();
    }

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=",
      "base64",
    );
    const demoImage = await upload(project.id, "效果图.png", "demo", png);
    const slides = await upload(
      project.id,
      "汇报稿.pptx",
      "demo",
      Buffer.from("test-presentation"),
    );
    await upload(project.id, "演示视频.mp4", "demo", Buffer.from("test-video"));
    await upload(
      project.id,
      "源代码.zip",
      "project",
      Buffer.from("project-file"),
    );

    const demos = await (
      await page.request.get(`/api/v1/projects/${project.id}/demo-files`)
    ).json();
    const files = await (
      await page.request.get(`/api/v1/projects/${project.id}/files`)
    ).json();
    expect(demos.items).toHaveLength(3);
    expect(demos.items.map((item: { kind: string }) => item.kind)).toEqual([
      "demo",
      "demo",
      "demo",
    ]);
    expect(files.items).toHaveLength(1);
    expect(files.items[0].kind).toBe("project");
    expect(
      demos.items.find((item: { id: number }) => item.id === demoImage.id)
        .previewable,
    ).toBe(true);
    expect(
      demos.items.find((item: { id: number }) => item.id === slides.id)
        .previewable,
    ).toBe(false);

    const preview = await page.request.get(
      `/api/v1/files/${demoImage.id}/preview`,
    );
    expect(preview.status()).toBe(200);
    expect(preview.headers()["content-type"]).toContain("image/png");
    expect(preview.headers()["content-disposition"]).toContain("inline");
    expect(
      (await page.request.get(`/api/v1/files/${slides.id}/preview`)).status(),
    ).toBe(415);
    expect(
      (
        await page.request.get(`/api/v1/files/${demoImage.id}/download`)
      ).status(),
    ).toBe(404);

    const disabledUpload = await page.request.post("/api/v1/uploads", {
      headers: {
        ...headers,
        "Upload-Length": "1",
        "Upload-Metadata": metadata(disabled.id, "禁止.png", "demo"),
      },
    });
    expect(disabledUpload.status()).toBe(400);
    const replacement = await page.request.post("/api/v1/uploads", {
      headers: {
        ...headers,
        "Upload-Length": "1",
        "Upload-Metadata": metadata(
          project.id,
          "错误替换.zip",
          "project",
          demoImage.id,
        ),
      },
    });
    expect(replacement.status()).toBe(400);

    await page.goto("/");
    await page.getByRole("button", { name: disabled.name }).click();
    await page.getByRole("button", { name: "编辑项目" }).click();
    await page.getByRole("tab", { name: "文件与演示" }).click();
    await page
      .getByRole("checkbox", { name: "为此项目启用演示材料模块" })
      .check();
    await expect(
      page.getByRole("heading", { name: "演示材料", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.getByLabel("选择演示材料").setInputFiles({
      name: "待保存演示.png",
      mimeType: "image/png",
      buffer: png,
    });
    const pendingDemo = page
      .locator(".file-tree-file")
      .filter({ hasText: "待保存演示.png" });
    await expect(pendingDemo).toContainText("待保存");
    await expect(pendingDemo.getByRole("link", { name: "下载" })).toHaveCount(
      0,
    );
    page.once("dialog", (dialog) => dialog.dismiss());
    await page
      .getByRole("checkbox", { name: "为此项目启用演示材料模块" })
      .click();
    await expect(
      page.getByRole("checkbox", { name: "为此项目启用演示材料模块" }),
    ).toBeChecked();
    await page.screenshot({
      path: "test-results/demo-pending.png",
      fullPage: true,
    });

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "返回项目" }).click();
    await expect(
      page.getByRole("heading", { name: "演示材料", exact: true }),
    ).toHaveCount(0);
    expect(
      (await page.request.get(`/api/v1/projects/${disabled.id}`)).json(),
    ).resolves.toMatchObject({ demoEnabled: false });

    await page.getByRole("button", { name: "编辑项目" }).click();
    await page.getByRole("tab", { name: "文件与演示" }).click();
    await page
      .getByRole("checkbox", { name: "为此项目启用演示材料模块" })
      .check();
    await page.getByLabel("选择演示材料").setInputFiles({
      name: "正式演示.png",
      mimeType: "image/png",
      buffer: png,
    });
    await expect(
      page.locator(".file-tree-file").filter({ hasText: "正式演示.png" }),
    ).toContainText("待保存");
    await page.getByRole("button", { name: "保存修改" }).click();
    await expect(
      page.getByRole("heading", { name: disabled.name, exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: "演示材料", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("正式演示.png", { exact: true })).toBeVisible();
    expect(
      (await page.request.get(`/api/v1/projects/${disabled.id}`)).json(),
    ).resolves.toMatchObject({ demoEnabled: true });

    await page.getByRole("button", { name: "返回项目列表" }).click();
    await page.getByRole("button", { name: project.name }).click();
    await expect(
      page.getByRole("heading", { name: "项目文件", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "全部下载" })).toHaveAttribute(
      "href",
      `/api/v1/projects/${project.id}/files/download-all`,
    );
    await expect(
      page.getByRole("heading", { name: "演示材料", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("img", { name: "效果图.png" })).toBeVisible();
    await expect(page.getByLabel("演示视频.mp4")).toBeVisible();
    await expect(page.getByText("此格式暂不支持在线展示")).toBeVisible();
    const demoPanel = page.locator(".files-panel").filter({
      has: page.getByRole("heading", { name: "演示材料", exact: true }),
    });
    await expect(demoPanel.getByRole("link", { name: "下载" })).toHaveCount(0);
    await expect(demoPanel.getByRole("button", { name: "预览" })).toHaveCount(
      0,
    );
    await page.screenshot({
      path: "test-results/demo-showcase.png",
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
