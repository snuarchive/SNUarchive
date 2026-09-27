import { describe, expect, it } from "vitest";
import type { H } from "../harness";
import { refs } from "../harness";

type Field = { field: string; code: string };
const fields = (res: { json: { error: { details: { fields: Field[] } } } }) =>
  res.json.error.details.fields;

export function adminLogScenarios(h: H) {
  describe("admin-logs", () => {
    it("adminListLogs pages newest first and filters", async () => {
      const r = refs(h.mock);
      const admin = await h.admin();
      const first = (await admin.get("/admin/logs?limit=50")).json;
      expect(first.items).toHaveLength(50);
      expect(first.nextCursor).toEqual(expect.any(String));
      const times = first.items.map((x: { createdAt: string }) =>
        Date.parse(x.createdAt),
      );
      expect(times).toEqual([...times].sort((a, b) => b - a));
      const second = (
        await admin.get(`/admin/logs?limit=50&cursor=${first.nextCursor}`)
      ).json;
      expect(second.items.length).toBeGreaterThan(10);

      const votes = (
        await admin.get(
          "/admin/logs?action=vote_cast&action=comment_create&limit=50",
        )
      ).json.items;
      expect(new Set(votes.map((x: { action: string }) => x.action))).toEqual(
        new Set(["vote_cast", "comment_create"]),
      );
      const mine = (
        await admin.get(`/admin/logs?userId=${r.student.id}&limit=50`)
      ).json.items;
      expect(
        mine.every((x: { user: { id: number } }) => x.user.id === r.student.id),
      ).toBe(true);
      const system = (await admin.get("/admin/logs?action=logs_archive")).json
        .items;
      expect(system[0]).toMatchObject({ user: null, ip: null });

      const from = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const until = new Date(Date.now() - 1 * 86_400_000).toISOString();
      const windowed = (
        await admin.get(`/admin/logs?from=${from}&until=${until}&limit=50`)
      ).json.items;
      expect(
        windowed.every(
          (x: { createdAt: string }) =>
            x.createdAt >= from && x.createdAt < until,
        ),
      ).toBe(true);
      expect((await admin.get("/admin/logs?action=bogus")).status).toBe(400);
      expect((await admin.get("/admin/logs?from=yesterday")).status).toBe(400);
      expect((await (await h.student()).get("/admin/logs")).status).toBe(403);
      expect((await h.client().get("/admin/logs")).status).toBe(401);
    });

    it("adminClearLogs needs confirmation and leaves one entry", async () => {
      const admin = await h.admin();
      expect((await admin.del("/admin/logs")).status).toBe(428);
      const total = h.mock.ctx.state.logs.length;
      const res = await admin.del("/admin/logs", {
        headers: { "x-confirm-delete": "true" },
      });
      expect(res.json.deleted).toBe(total);
      const left = (await admin.get("/admin/logs")).json.items;
      expect(left).toHaveLength(1);
      expect(left[0]).toMatchObject({
        action: "logs_clear",
        metadata: { deleted: total },
      });
      expect(
        (
          await admin.del("/admin/logs", {
            csrf: false,
            headers: { "x-confirm-delete": "true" },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await (
            await h.student()
          ).del("/admin/logs", { headers: { "x-confirm-delete": "true" } })
        ).status,
      ).toBe(403);
      expect((await h.client().del("/admin/logs")).status).toBe(401);
    });

    it("adminExportLogs streams every format", async () => {
      const admin = await h.admin();
      const json = await admin.get(
        "/admin/logs/export?format=json&action=login",
      );
      expect(json.status).toBe(200);
      expect(json.headers.get("content-disposition")).toMatch(
        /^attachment; filename="activity-logs-\d{8}\.json"$/,
      );
      expect(
        json.json.every((x: { action: string }) => x.action === "login"),
      ).toBe(true);
      const t = json.json.map((x: { createdAt: string }) =>
        Date.parse(x.createdAt),
      );
      expect(t).toEqual([...t].sort((a, b) => a - b));

      const jsonl = await admin.get(
        "/admin/logs/export?format=jsonl&action=login",
      );
      expect(
        Buffer.from(jsonl.bytes).toString().trim().split("\n"),
      ).toHaveLength(json.json.length);
      const csv = await admin.get("/admin/logs/export?format=csv&action=login");
      expect(Buffer.from(csv.bytes).toString().split("\r\n")[0]).toBe(
        "id,createdAt,action,userId,userDisplayName,ip,metadata",
      );
      const xlsx = await admin.get("/admin/logs/export?format=xlsx");
      expect(Buffer.from(xlsx.bytes).subarray(0, 2).toString()).toBe("PK");
      const parquet = await admin.get("/admin/logs/export?format=parquet");
      expect(parquet.headers.get("content-type")).toBe(
        "application/vnd.apache.parquet",
      );

      expect((await admin.get("/admin/logs/export")).status).toBe(400);
      expect((await admin.get("/admin/logs/export?format=pdf")).status).toBe(
        400,
      );
      expect(
        (await (await h.student()).get("/admin/logs/export?format=json"))
          .status,
      ).toBe(403);
      expect(
        (await h.client().get("/admin/logs/export?format=json")).status,
      ).toBe(401);
    });

    it("adminExportLogs refuses more than EXPORT_MAX_ROWS", async () => {
      const app = h.app({ exportMaxRows: 10 });
      const admin = await h.as("admin@snu.ac.kr", app);
      const res = await admin.get("/admin/logs/export?format=csv");
      expect(res.status).toBe(413);
      expect(res.json.error).toMatchObject({
        code: "EXPORT_TOO_LARGE",
        details: { limit: 10, count: expect.any(Number) },
      });
    });

    it("adminPreviewLogDelete and adminDeleteLogs delete exactly what was previewed", async () => {
      const r = refs(h.mock);
      const admin = await h.admin();
      const filter = { action: ["vote_cast"], userId: r.student.id };
      const preview = await admin.post("/admin/logs/delete-preview", {
        json: filter,
      });
      expect(preview.status).toBe(200);
      expect(preview.json.count).toBeGreaterThan(0);
      const del = await admin.post("/admin/logs/delete", {
        json: { ...filter, token: preview.json.token },
      });
      expect(del.json.deleted).toBe(preview.json.count);
      expect(
        (await admin.get(`/admin/logs?action=vote_cast&userId=${r.student.id}`))
          .json.items,
      ).toEqual([]);
      const reused = await admin.post("/admin/logs/delete", {
        json: { ...filter, token: preview.json.token },
      });
      expect(reused.status).toBe(409);
      expect(reused.json.error.code).toBe("DELETE_PREVIEW_MISMATCH");

      const p2 = (
        await admin.post("/admin/logs/delete-preview", {
          json: { action: ["login"] },
        })
      ).json;
      expect(
        (
          await admin.post("/admin/logs/delete", {
            json: { action: ["vote_cast"], token: p2.token },
          })
        ).status,
      ).toBe(409);
      await h.admin(); // another login changes the count
      expect(
        (
          await admin.post("/admin/logs/delete", {
            json: { action: ["login"], token: p2.token },
          })
        ).status,
      ).toBe(409);

      expect(
        fields(await admin.post("/admin/logs/delete-preview", { json: {} })),
      ).toEqual([{ field: "", code: "REQUIRED" }]);
      const inverted = await admin.post("/admin/logs/delete-preview", {
        json: { from: "2026-02-01T00:00:00Z", until: "2026-01-01T00:00:00Z" },
      });
      expect(fields(inverted)).toEqual([
        { field: "until", code: "WINDOW_INVERTED" },
      ]);
      expect(
        fields(
          await admin.post("/admin/logs/delete", {
            json: { action: ["login"] },
          }),
        ),
      ).toEqual([{ field: "token", code: "REQUIRED" }]);
      expect(
        (
          await admin.post("/admin/logs/delete-preview", {
            json: filter,
            csrf: false,
          })
        ).status,
      ).toBe(403);
      expect(
        (await h.client().post("/admin/logs/delete-preview", { json: filter }))
          .status,
      ).toBe(401);
      expect(
        (
          await h
            .client()
            .post("/admin/logs/delete", { json: { ...filter, token: "x" } })
        ).status,
      ).toBe(401);
    });

    it("adminListArchiveRuns lists runs newest first", async () => {
      const admin = await h.admin();
      const res = await admin.get("/admin/logs/archive-runs");
      expect(res.json.items.map((x: { status: string }) => x.status)).toEqual([
        "succeeded",
        "failed",
        "succeeded",
        "succeeded",
      ]);
      expect(res.json.items[1].error).toEqual(expect.any(String));
      expect(
        (await admin.get("/admin/logs/archive-runs?cursor=bad")).status,
      ).toBe(400);
      expect(
        (await (await h.student()).get("/admin/logs/archive-runs")).status,
      ).toBe(403);
      expect((await h.client().get("/admin/logs/archive-runs")).status).toBe(
        401,
      );
    });
  });
}
