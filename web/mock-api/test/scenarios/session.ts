import { describe, expect, it } from "vitest";
import type { H } from "../harness";
import { refs, SEED_ACCOUNTS } from "../harness";

export function sessionScenarios(h: H) {
  describe("session", () => {
    it("getConfig is public and carries the reference data", async () => {
      const res = await h.client().get("/config");
      expect(res.status).toBe(200);
      expect(res.json.semesters.map((s: { label: string }) => s.label)).toEqual(
        ["1학기", "여름학기", "2학기", "겨울학기"],
      );
      expect(
        res.json.assessmentKinds.find(
          (k: { code: string }) => k.code === "exam",
        ).labelFormat,
      ).toBe("{n}차 시험");
      expect(res.json.upload.maxBytes).toBe(3 * 1024 * 1024);
    });

    it("startGoogleLogin redirects to the mock account chooser", async () => {
      const res = await h.client().get("/auth/google");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(
        `${h.mock.ctx.options.mockOrigin}/__mock/google`,
      );
      const page = await h.client().get("/__mock/google");
      const html = Buffer.from(page.bytes).toString("utf8");
      expect(html).toContain("student@snu.ac.kr");
      expect(html).toContain("someone@gmail.com");
      expect(html).toContain(
        `${h.mock.ctx.options.appOrigin}/api/v1/auth/google/callback?mock_email=`,
      );
    });

    it("googleLoginCallback signs in SNU accounts and refuses others", async () => {
      const app = h.mock.ctx.options.appOrigin;
      const missing = await h.client().get("/auth/google/callback");
      expect(missing.headers.get("location")).toBe(`${app}/?auth=error`);
      const cancelled = await h
        .client()
        .get("/auth/google/callback?error=access_denied");
      expect(cancelled.headers.get("location")).toBe(`${app}/?auth=error`);
      const gmail = await h
        .client()
        .get("/auth/google/callback?mock_email=someone%40gmail.com");
      expect(gmail.status).toBe(302);
      expect(gmail.headers.get("location")).toBe(`${app}/?auth=forbidden`);
      expect(gmail.headers.getSetCookie()).toEqual([]);

      const c = h.client();
      const ok = await c.get(
        "/auth/google/callback?mock_email=student%40snu.ac.kr",
      );
      expect(ok.headers.get("location")).toBe(`${app}/?auth=ok`);
      const [session, csrf] = ["snu_session", "snu_csrf"].map((n) =>
        ok.headers.getSetCookie().find((x) => x.startsWith(`${n}=`))!,
      );
      expect(session).toMatch(/HttpOnly/i);
      expect(session).toMatch(/SameSite=Lax/i);
      expect(session).toMatch(/Path=\//);
      expect(csrf).not.toMatch(/HttpOnly/i);
      expect(csrf).toMatch(/SameSite=Lax/i);
      expect((await c.get("/me")).json.email).toBe("student@snu.ac.kr");
    });

    it("devLogin upserts, resolves admin rights and validates the email", async () => {
      const admin = await h.admin();
      expect((await admin.get("/me")).json.isAdmin).toBe(true);
      const moderator = await h.as(SEED_ACCOUNTS.moderator);
      expect((await moderator.get("/me")).json.isAdmin).toBe(true);
      const fresh = await h.client().login("2024-10001@snu.ac.kr", "신입생");
      const me = (await fresh.get("/me")).json;
      expect(me).toMatchObject({
        displayName: "신입생",
        isAdmin: false,
        college: null,
        suggestedAdmissionYear: 2024,
      });

      const bad = await h
        .client()
        .post("/auth/dev-login", { json: { email: "someone@gmail.com" } });
      expect(bad.status).toBe(422);
      expect(bad.json.error.details.fields).toEqual([
        { field: "email", code: "INVALID_EMAIL" },
      ]);
      const missing = await h.client().post("/auth/dev-login", { json: {} });
      expect(missing.status).toBe(422);
      expect(missing.json.error.details.fields[0]).toEqual({
        field: "email",
        code: "REQUIRED",
      });
    });

    it("ADMIN_EMAILS decides env admins", async () => {
      const app = h.app({ adminEmails: ["student@snu.ac.kr"] });
      expect(
        (await (await h.as(SEED_ACCOUNTS.student, app)).get("/me")).json
          .isAdmin,
      ).toBe(true);
      expect(
        (await (await h.as(SEED_ACCOUNTS.admin, app)).get("/me")).json.isAdmin,
      ).toBe(false);
    });

    it("getMe needs a session", async () => {
      const res = await h.client().get("/me");
      expect(res.status).toBe(401);
      expect(res.json.error.code).toBe("NOT_AUTHENTICATED");
      expect(res.json.error.requestId).toBe(res.headers.get("x-request-id"));
      const me = (await (await h.student()).get("/me")).json;
      expect(me.calendar.timezone).toBe("Asia/Seoul");
      expect(me.college).toBe("자연과학대학");
    });

    it("updateMe edits the profile and enforces CSRF and Origin", async () => {
      const c = await h.as(SEED_ACCOUNTS.newbie);
      const ok = await c.patch("/me", {
        json: { college: "공과대학", admissionYear: 2026 },
      });
      expect(ok.status).toBe(200);
      expect(ok.json).toMatchObject({
        college: "공과대학",
        admissionYear: 2026,
      });
      expect((await c.get("/me")).json.college).toBe("공과대학");
      expect(
        (await c.patch("/me", { json: { college: null } })).json.college,
      ).toBeNull();

      const bad = await c.patch("/me", {
        json: { college: "호그와트", admissionYear: 1970 },
      });
      expect(bad.status).toBe(422);
      expect(bad.json.error.details.fields).toEqual([
        { field: "college", code: "INVALID_COLLEGE" },
        { field: "admissionYear", code: "INVALID_ADMISSION_YEAR" },
      ]);
      expect((await c.patch("/me", { json: {} })).status).toBe(422);

      const noToken = await c.patch("/me", {
        json: { admissionYear: 2025 },
        csrf: false,
      });
      expect(noToken.status).toBe(403);
      expect(noToken.json.error.code).toBe("CSRF_INVALID");
      const wrongToken = await c.patch("/me", {
        json: { admissionYear: 2025 },
        headers: { "x-csrf-token": "nope" },
      });
      expect(wrongToken.status).toBe(403);
      const wrongOrigin = await c.patch("/me", {
        json: { admissionYear: 2025 },
        origin: "https://evil.example",
      });
      expect(wrongOrigin.status).toBe(403);
      const noOrigin = await c.patch("/me", {
        json: { admissionYear: 2025 },
        origin: null,
      });
      expect(noOrigin.status).toBe(403);
      expect(
        (await h.client().patch("/me", { json: { college: null } })).status,
      ).toBe(401);
    });

    it("logout ends this session only", async () => {
      const a = await h.student();
      const b = await h.student();
      const stolen = new Map(a.jar);
      const res = await a.post("/auth/logout");
      expect(res.status).toBe(204);
      expect(a.jar.size).toBe(0);
      const replay = h.client();
      for (const [k, v] of stolen) replay.jar.set(k, v);
      expect((await replay.get("/me")).status).toBe(401);
      expect((await b.get("/me")).status).toBe(200);
      expect((await h.client().post("/auth/logout")).status).toBe(401);
    });

    it("logoutAll ends every session of the user", async () => {
      const a = await h.student();
      const b = await h.student();
      expect((await a.post("/me/logout-all", { csrf: false })).status).toBe(
        403,
      );
      expect((await a.post("/me/logout-all")).status).toBe(204);
      expect((await b.get("/me")).status).toBe(401);
      expect((await h.client().post("/me/logout-all")).status).toBe(401);
      expect((await (await h.student()).get("/me")).status).toBe(200);
    });

    it("deleteMe needs confirmation, then scrubs the account", async () => {
      const r = refs(h.mock);
      const c = await h.student();
      const other = await h.student();
      const unconfirmed = await c.del("/me");
      expect(unconfirmed.status).toBe(428);
      expect(unconfirmed.json.error.code).toBe("CONFIRMATION_REQUIRED");
      expect(
        (
          await c.del("/me", {
            csrf: false,
            headers: { "x-confirm-delete": "true" },
          })
        ).status,
      ).toBe(403);
      expect(
        (await c.del("/me", { headers: { "x-confirm-delete": "true" } }))
          .status,
      ).toBe(204);
      expect((await other.get("/me")).status).toBe(401);
      expect((await h.client().del("/me")).status).toBe(401);

      const admin = await h.admin();
      const scrubbed = (await admin.get(`/admin/users/${r.student.id}`)).json;
      expect(scrubbed).toMatchObject({
        email: null,
        displayName: null,
        isAdmin: false,
      });
      expect(scrubbed.deletedAt).not.toBeNull();
      const comments = (
        await admin.get(`/admin/comments?courseId=${r.course.id}&limit=50`)
      ).json.items;
      expect(
        comments
          .filter((x: { user: { id: number } }) => x.user.id === r.student.id)
          .every((x: { author: null }) => x.author === null),
      ).toBe(true);
      // Signing in again creates a new account.
      const again = (await (await h.student()).get("/me")).json;
      expect(again.id).not.toBe(r.student.id);
    });

    it("listMyFavorites pages most recently pinned first", async () => {
      const r = refs(h.mock);
      const c = await h.student();
      const first = await c.get("/me/favorites?limit=2");
      expect(first.status).toBe(200);
      expect(first.json.items[0].id).toBe(r.course.id);
      expect(first.json.nextCursor).toEqual(expect.any(String));
      const second = await c.get(
        `/me/favorites?limit=2&cursor=${first.json.nextCursor}`,
      );
      expect(second.json.items).toHaveLength(2);
      expect(second.json.nextCursor).toBeNull();
      expect((await c.get("/me/favorites?cursor=garbage")).status).toBe(400);
      expect((await c.get("/me/favorites?limit=0")).status).toBe(400);
      expect((await c.get("/me/favorites?limit=51")).status).toBe(400);
      expect((await h.client().get("/me/favorites")).status).toBe(401);
      expect(
        (await (await h.as(SEED_ACCOUNTS.newbie)).get("/me/favorites")).json,
      ).toEqual({ items: [], nextCursor: null });
    });

    it("listMyFavoriteIds lists pinned ids", async () => {
      const c = await h.student();
      const res = await c.get("/me/favorites/ids");
      expect(res.json.ids).toHaveLength(4);
      expect(res.json.ids[0]).toBe(refs(h.mock).course.id);
      expect((await h.client().get("/me/favorites/ids")).status).toBe(401);
    });
  });
}
