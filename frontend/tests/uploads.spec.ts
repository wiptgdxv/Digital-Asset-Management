import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

test("上传协议：续传、隔离、下载、删除、5GB上限", async ({
  request,
  playwright,
}) => {
  const key = randomUUID().replaceAll("-", "").slice(0, 12),
    username = `owner-${key}`,
    otherUsername = `co-${key}`,
    password = "Test-Only-Pass-1023";
  const other = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:5173",
  });
  try {
    for (const [client, mail] of [
      [request, username],
      [other, otherUsername],
    ] as const) {
      expect(
        (
          await client.post("/api/v1/auth/register", {
            data: { name: "上传验收", username: mail, password },
          })
        ).status(),
      ).toBe(200);
      expect(
        (
          await client.post("/api/v1/auth/login", {
            data: { username: mail, password },
          })
        ).status(),
      ).toBe(200);
    }
    const csrf = (await (await request.get("/api/v1/auth/me")).json())
        .csrfToken,
      otherCSRF = (await (await other.get("/api/v1/auth/me")).json()).csrfToken;
    const headers = { "X-CSRF-Token": csrf, "Tus-Resumable": "1.0.0" };
    const p = await (
      await request.post("/api/v1/projects", {
        headers,
        data: {
          name: "文件验收 " + key,
          summary: "",
          readme: "",
          category: "其他",
          demoEnabled: false,
          collaboratorIds: [],
        },
      })
    ).json();
    function metadata(name: string, replace = 0, relativePath = "") {
      return Object.entries({
        filename: name,
        projectId: String(p.id),
        replaceId: String(replace),
        relativePath,
      })
        .map(([k, v]) => k + " " + Buffer.from(v).toString("base64"))
        .join(",");
    }
    async function create(
      name: string,
      length: number,
      replace = 0,
      relativePath = "",
    ) {
      const r = await request.post("/api/v1/uploads", {
        headers: {
          ...headers,
          "Upload-Length": String(length),
          "Upload-Metadata": metadata(name, replace, relativePath),
        },
      });
      return r;
    }
    expect((await create("大文件.bin", 5_000_000_001)).status()).toBe(413);
    expect((await create("../越界.txt", 3)).status()).toBe(400);
    expect((await create("越界.txt", 3, 0, "../秘密")).status()).toBe(400);
    expect((await create("越界.txt", 3, 0, "目录\\子目录")).status()).toBe(400);
    const accepted = await create("上限.bin", 5_000_000_000);
    expect(accepted.status()).toBe(201);
    const created = await create("原始.txt", 6);
    expect(created.status()).toBe(201);
    const url = created.headers().location,
      id = url.split("/").pop()!;
    expect(
      (
        await other.head(url, { headers: { "Tus-Resumable": "1.0.0" } })
      ).status(),
    ).toBe(403);
    expect(
      (
        await other.patch(url, {
          headers: {
            "Tus-Resumable": "1.0.0",
            "Upload-Offset": "0",
            "Content-Type": "application/offset+octet-stream",
            "X-CSRF-Token": otherCSRF,
          },
          data: Buffer.from("bad"),
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await request.patch(url, {
          headers: {
            ...headers,
            "Upload-Offset": "0",
            "Content-Type": "application/offset+octet-stream",
          },
          data: Buffer.from("abc"),
        })
      ).status(),
    ).toBe(204);
    const head = await request.head(url, { headers });
    expect(head.headers()["upload-offset"]).toBe("3");
    expect(
      (
        await request.post(`/api/v1/uploads/${id}/complete`, { headers })
      ).status(),
    ).toBe(409);
    expect(
      (await (await request.get(`/api/v1/projects/${p.id}/files`)).json())
        .items,
    ).toHaveLength(0);
    expect(
      (
        await request.patch(url, {
          headers: {
            ...headers,
            "Upload-Offset": "0",
            "Content-Type": "application/offset+octet-stream",
          },
          data: Buffer.from("bad"),
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await request.patch(url, {
          headers: {
            ...headers,
            "Upload-Offset": "3",
            "Content-Type": "application/offset+octet-stream",
          },
          data: Buffer.from("def"),
        })
      ).status(),
    ).toBe(204);
    const finished = await request.post(`/api/v1/uploads/${id}/complete`, {
      headers,
    });
    expect(finished.status()).toBe(200);
    const file = await finished.json();
    expect(
      (
        await request.post(`/api/v1/uploads/${id}/complete`, { headers })
      ).status(),
    ).toBe(200);
    expect(
      await (await other.get(`/api/v1/files/${file.id}/download`)).text(),
    ).toBe("abcdef");
    const range = await request.get(`/api/v1/files/${file.id}/download`, {
      headers: { Range: "bytes=2-4" },
    });
    expect(range.status()).toBe(206);
    expect(await range.text()).toBe("cde");
    expect((await create("新版.txt", 3, file.id)).status()).toBe(400);
    expect(
      await (await request.get(`/api/v1/files/${file.id}/download`)).text(),
    ).toBe("abcdef");
    const removable = await create("待删除.txt", 3),
      removableURL = removable.headers().location,
      removableID = removableURL.split("/").pop()!;
    expect(
      (
        await request.patch(removableURL, {
          headers: {
            ...headers,
            "Upload-Offset": "0",
            "Content-Type": "application/offset+octet-stream",
          },
          data: Buffer.from("old"),
        })
      ).status(),
    ).toBe(204);
    const removableFile = await (
      await request.post(`/api/v1/uploads/${removableID}/complete`, {
        headers,
      })
    ).json();
    expect(
      (
        await other.delete(`/api/v1/files/${removableFile.id}`, {
          headers: { "X-CSRF-Token": otherCSRF },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await request.get(`/api/v1/files/${removableFile.id}/download`)
      ).status(),
    ).toBe(404);
    await expect
      .poll(() => existsSync(resolve("..", "uploads", removableID)), {
        timeout: 15000,
      })
      .toBe(false);
    expect(existsSync(resolve("..", "uploads", id))).toBe(true);
    const zero = await create("空文件.txt", 0);
    expect(zero.status()).toBe(201);
    expect(
      (
        await request.post(
          "/api/v1/uploads/" +
            zero.headers().location.split("/").pop() +
            "/complete",
          { headers },
        )
      ).status(),
    ).toBe(200);
    const archive = await other.get(
      `/api/v1/projects/${p.id}/files/download-all`,
    );
    expect(archive.status()).toBe(200);
    expect(archive.headers()["content-type"]).toContain("application/zip");
    expect(archive.headers()["content-disposition"]).toContain("attachment");
    const archiveBody = await archive.body();
    expect(archiveBody.subarray(0, 2).toString()).toBe("PK");
    expect(archiveBody.includes(Buffer.from("原始.txt"))).toBe(true);
    expect(archiveBody.includes(Buffer.from("空文件.txt"))).toBe(true);
    expect(archiveBody.includes(Buffer.from("abcdef"))).toBe(true);
    const nested = await create("配置.txt", 4, 0, "源码/config"),
      nestedURL = nested.headers().location,
      nestedID = nestedURL.split("/").pop()!;
    expect(nested.status()).toBe(201);
    expect(
      (
        await request.patch(nestedURL, {
          headers: {
            ...headers,
            "Upload-Offset": "0",
            "Content-Type": "application/offset+octet-stream",
          },
          data: Buffer.from("tree"),
        })
      ).status(),
    ).toBe(204);
    const nestedFile = await request.post(
      `/api/v1/uploads/${nestedID}/complete`,
      { headers },
    );
    expect(nestedFile.status()).toBe(200);
    expect((await nestedFile.json()).relativePath).toBe("源码/config");
    const nestedArchive = await other.get(
      `/api/v1/projects/${p.id}/files/download-all`,
    );
    const nestedArchiveBody = await nestedArchive.body();
    expect(
      nestedArchiveBody.includes(Buffer.from("源码/config/配置.txt")),
    ).toBe(true);
    expect(nestedArchiveBody.includes(Buffer.from("tree"))).toBe(true);

    const sourceFolderArchive = await other.get(
      `/api/v1/projects/${p.id}/files/download-folder?folder=${encodeURIComponent("源码")}`,
    );
    expect(sourceFolderArchive.status()).toBe(200);
    expect(sourceFolderArchive.headers()["content-type"]).toContain(
      "application/zip",
    );
    const sourceFolderBody = await sourceFolderArchive.body();
    expect(sourceFolderBody.includes(Buffer.from("源码/config/配置.txt"))).toBe(
      true,
    );
    expect(sourceFolderBody.includes(Buffer.from("原始.txt"))).toBe(false);

    const nestedFolderArchive = await other.get(
      `/api/v1/projects/${p.id}/files/download-folder?folder=${encodeURIComponent("源码/config")}`,
    );
    expect(nestedFolderArchive.status()).toBe(200);
    expect(nestedFolderArchive.headers()["content-disposition"]).toContain(
      "config.zip",
    );
    expect(
      (await nestedFolderArchive.body()).includes(
        Buffer.from("config/配置.txt"),
      ),
    ).toBe(true);
    expect(
      (
        await other.get(
          `/api/v1/projects/${p.id}/files/download-folder?folder=${encodeURIComponent("../源码")}`,
        )
      ).status(),
    ).toBe(400);
    expect(
      (
        await other.get(
          `/api/v1/projects/${p.id}/files/download-folder?folder=不存在`,
        )
      ).status(),
    ).toBe(404);
  } finally {
    await other.dispose();
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
        `BEGIN; DELETE FROM projects WHERE author_id IN (SELECT id FROM users WHERE username IN ('${username}','${otherUsername}')); DELETE FROM users WHERE username IN ('${username}','${otherUsername}'); COMMIT;`,
      ],
      { cwd: "..", stdio: "pipe" },
    );
  }
});
