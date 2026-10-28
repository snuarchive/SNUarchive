import { describe, expect, it } from "vitest";
import type { H } from "../harness";
import { refs } from "../harness";

export function mockControlScenarios(h: H) {
  describe("mock control", () => {
    it("health reports the catalog and clock", async () => {
      const res = await h.client().get("/__mock/health");
      expect(res.json).toMatchObject({
        ok: true,
        courses: h.mock.ctx.catalog.courses.length,
      });
    });

    it("reset restores the seed and keeps seeded sessions", async () => {
      const r = refs(h.mock);
      const c = await h.student();
      await c.post(`/courses/${r.course.id}/comments`, {
        json: { body: "초기화 전 댓글" },
      });
      const before = (await c.get(`/courses/${r.course.id}`)).json.comments
        .items[0].body;
      expect(before).toBe("초기화 전 댓글");
      expect((await h.client().post("/__mock/reset")).json).toEqual({
        ok: true,
      });
      const after = await c.get(`/courses/${r.course.id}`);
      expect(after.status).toBe(200);
      expect(after.json.comments.items[0].body).not.toBe("초기화 전 댓글");
    });

    it("faults fail the next matching request once", async () => {
      const c = await h.student();
      const set = await h.client().post("/__mock/faults", {
        json: {
          method: "GET",
          path: "/me",
          status: 401,
          code: "NOT_AUTHENTICATED",
        },
      });
      expect(set.status).toBe(201);
      const failed = await c.get("/me");
      expect(failed.status).toBe(401);
      expect(failed.json.error.requestId).toBe(
        failed.headers.get("x-request-id"),
      );
      expect((await c.get("/me")).status).toBe(200);

      await h.client().post("/__mock/faults", {
        json: {
          method: "PUT",
          path: "/api/v1/sittings/*/vote",
          status: 409,
          code: "VOTING_NOT_OPEN",
        },
      });
      const r = refs(h.mock);
      const vote = await c.put(`/sittings/${r.openEndedSitting.id}/vote`, {
        json: { rating: 3 },
      });
      expect(vote.json.error.code).toBe("VOTING_NOT_OPEN");

      await h.client().post("/__mock/faults", {
        json: { path: "/config", status: 503, code: "INTERNAL" },
      });
      expect((await c.get("/config", { unchecked: true })).status).toBe(503);
      expect(
        (
          await h
            .client()
            .post("/__mock/faults", { json: { path: "/me", status: 200 } })
        ).status,
      ).toBe(400);
      expect(
        (
          await h.client().post("/__mock/faults", {
            json: { path: "/me", status: 400, code: "NOPE" },
          })
        ).status,
      ).toBe(400);
    });

    it("unknown routes are JSON 404s", async () => {
      const res = await h.client().get("/api/v1/nope", { unchecked: true });
      expect(res.status).toBe(404);
      expect(res.json.error.code).toBe("NOT_FOUND");
    });
  });
}
