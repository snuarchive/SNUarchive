import { describe, expect, it } from "vitest";
import type { H } from "../harness";
import { refs, SEED_ACCOUNTS, UNKNOWN_ID } from "../harness";

export function consoleScenarios(h: H) {
  describe("console", () => {
    it("adminGetDashboard summarises the whole site", async () => {
      const admin = await h.admin();
      const res = await admin.get("/admin/dashboard");
      expect(res.status).toBe(200);
      const d = res.json;
      expect(d.term).toEqual(
        (await admin.get("/me")).json.calendar.currentTerm,
      );
      expect(d.queue).toMatchObject({
        pendingUploads: 3,
        openVotingRequests: 4,
      });
      expect(d.voting).toEqual({
        openCount: 3,
        openEndedCount: 1,
        closingWithin24h: 1,
      });
      expect(d.coverage.withStatistics).toBeGreaterThan(5);
      expect(d.users).toMatchObject({ admins: 2 });
      // An env address that has never signed in is not counted.
      const ghost = h.app({
        adminEmails: ["admin@snu.ac.kr", "ghost@snu.ac.kr"],
      });
      expect(
        (await (await h.as(SEED_ACCOUNTS.admin, ghost)).get("/admin/dashboard"))
          .json.users.admins,
      ).toBe(2);
      expect(d.trend.statistics).toHaveLength(d.trend.days);
      expect(d.catalog.lastImport.status).toBe("succeeded");
      expect((await (await h.student()).get("/admin/dashboard")).status).toBe(
        403,
      );
      expect((await h.client().get("/admin/dashboard")).status).toBe(401);
    });

    it("adminGetUserSummary aggregates live accounts", async () => {
      const admin = await h.admin();
      const res = (await admin.get("/admin/users/summary")).json;
      const live = h.mock.ctx.state.users.filter((u) => !u.deletedAt).length;
      expect(res.totalUsers).toBe(live);
      expect(res.withProfile).toBeLessThan(live);
      // A college or an admission year (either) is enough.
      const newbie = await h.as(SEED_ACCOUNTS.newbie);
      await newbie.patch("/me", { json: { admissionYear: 2026 } });
      expect((await admin.get("/admin/users/summary")).json.withProfile).toBe(
        res.withProfile + 1,
      );
      await newbie.patch("/me", {
        json: { admissionYear: null, college: "공과대학" },
      });
      expect((await admin.get("/admin/users/summary")).json.withProfile).toBe(
        res.withProfile + 1,
      );
      expect(
        res.byCollege.find((x: { college: string }) => x.college === "공과대학")
          .count,
      ).toBeGreaterThan(2);
      const years = res.byAdmissionYear.map((x: { year: number }) => x.year);
      expect(years).toEqual([...years].sort());
      expect(
        (await (await h.student()).get("/admin/users/summary")).status,
      ).toBe(403);
      expect((await h.client().get("/admin/users/summary")).status).toBe(401);
    });

    it("adminFindUserByEmail and adminGetUser look up single accounts", async () => {
      const r = refs(h.mock);
      const admin = await h.admin();
      const found = await admin.get(
        `/admin/users?email=${encodeURIComponent("Student@snu.ac.kr")}`,
      );
      expect(found.json).toMatchObject({
        id: r.student.id,
        isAdmin: false,
        adminSource: null,
        deletedAt: null,
      });
      expect(
        (await admin.get("/admin/users?email=nobody%40snu.ac.kr")).status,
      ).toBe(404);
      const byId = await admin.get(`/admin/users/${r.moderator.id}`);
      expect(byId.json).toMatchObject({ isAdmin: true, adminSource: "db" });
      expect(
        (await admin.get(`/admin/users/${r.admin.id}`)).json.adminSource,
      ).toBe("env");
      const scrubbed = (await admin.get(`/admin/users/${r.deletedUser.id}`))
        .json;
      expect(scrubbed).toMatchObject({
        email: null,
        lastIp: null,
        isAdmin: false,
        deletedAt: expect.any(String),
      });
      expect((await admin.get(`/admin/users/${UNKNOWN_ID}`)).status).toBe(404);
      expect(
        (await (await h.student()).get(`/admin/users/${r.student.id}`)).status,
      ).toBe(403);
      expect(
        (await h.client().get(`/admin/users/${r.student.id}`)).status,
      ).toBe(401);
      expect(
        (await (await h.student()).get("/admin/users?email=a%40snu.ac.kr"))
          .status,
      ).toBe(403);
      expect(
        (await h.client().get("/admin/users?email=a%40snu.ac.kr")).status,
      ).toBe(401);
    });

    it("adminListAdmins unions database grants and ADMIN_EMAILS", async () => {
      const admin = await h.admin();
      const items = (await admin.get("/admin/admins")).json.items;
      expect(
        items.map((x: { email: string; source: string }) => [
          x.email,
          x.source,
        ]),
      ).toEqual([
        ["admin@snu.ac.kr", "env"],
        ["moderator@snu.ac.kr", "db"],
      ]);
      const app = h.app({
        adminEmails: [
          "admin@snu.ac.kr",
          "ghost@snu.ac.kr",
          "moderator@snu.ac.kr",
        ],
      });
      const other = (
        await (await h.as(SEED_ACCOUNTS.admin, app)).get("/admin/admins")
      ).json.items;
      expect(
        other.find((x: { email: string }) => x.email === "ghost@snu.ac.kr"),
      ).toEqual({ email: "ghost@snu.ac.kr", source: "env", user: null });
      expect(
        other.find((x: { email: string }) => x.email === "moderator@snu.ac.kr")
          .source,
      ).toBe("both");
      expect((await (await h.student()).get("/admin/admins")).status).toBe(403);
      expect((await h.client().get("/admin/admins")).status).toBe(401);
    });

    it("adminGrantAdmin promotes by id, idempotently", async () => {
      const r = refs(h.mock);
      const admin = await h.admin();
      const student = await h.student();
      expect((await student.get("/admin/dashboard")).status).toBe(403);
      const res = await admin.post("/admin/admins", {
        json: { userId: r.student.id },
      });
      expect(res.json).toMatchObject({
        id: r.student.id,
        isAdmin: true,
        adminSource: "db",
      });
      expect(
        (await admin.post("/admin/admins", { json: { userId: r.student.id } }))
          .status,
      ).toBe(200);
      expect((await student.get("/admin/dashboard")).status).toBe(200);
      expect(
        (await admin.post("/admin/admins", { json: { userId: UNKNOWN_ID } }))
          .status,
      ).toBe(404);
      expect(
        (
          await admin.post("/admin/admins", {
            json: { userId: r.deletedUser.id },
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await admin.post("/admin/admins", {
            json: { userId: r.student.id },
            csrf: false,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await h
            .client()
            .post("/admin/admins", { json: { userId: r.student.id } })
        ).status,
      ).toBe(401);
    });

    it("adminRevokeAdmin revokes database grants only", async () => {
      const r = refs(h.mock);
      const admin = await h.admin();
      const moderator = await h.as(SEED_ACCOUNTS.moderator);
      expect((await admin.del(`/admin/admins/${r.moderator.id}`)).status).toBe(
        204,
      );
      expect((await moderator.get("/me")).status).toBe(401);
      expect(
        (await (await h.as(SEED_ACCOUNTS.moderator)).get("/admin/dashboard"))
          .status,
      ).toBe(403);
      const env = await admin.del(`/admin/admins/${r.admin.id}`);
      expect(env.status).toBe(409);
      expect(env.json.error.code).toBe("ENV_ADMIN_PROTECTED");
      expect((await admin.del(`/admin/admins/${UNKNOWN_ID}`)).status).toBe(404);
      // An account that is not an admin is 404, not a no-op.
      const plain = await admin.del(`/admin/admins/${r.student.id}`);
      expect(plain.status).toBe(404);
      expect(plain.json.error.code).toBe("NOT_FOUND");
      expect(
        (await admin.del(`/admin/admins/${r.deletedUser.id}`)).status,
      ).toBe(404);
      expect(
        (await (await h.student()).del(`/admin/admins/${r.moderator.id}`))
          .status,
      ).toBe(403);
      expect(
        (await h.client().del(`/admin/admins/${r.moderator.id}`)).status,
      ).toBe(401);

      // With no env admins, the last database admin cannot be revoked.
      const app = h.app({ adminEmails: [] });
      const lone = await h.as(SEED_ACCOUNTS.moderator, app);
      const last = await lone.del(`/admin/admins/${r.moderator.id}`);
      expect(last.status).toBe(409);
      expect(last.json.error.code).toBe("LAST_ADMIN_PROTECTED");

      // An env address that has never signed in is not another admin.
      const ghost = h.app({ adminEmails: ["ghost@snu.ac.kr"] });
      const self = await h.as(SEED_ACCOUNTS.moderator, ghost);
      const refused = await self.del(`/admin/admins/${r.moderator.id}`);
      expect(refused.status).toBe(409);
      expect(refused.json.error.code).toBe("LAST_ADMIN_PROTECTED");
      // Once it has signed in, it counts.
      await h.as("ghost@snu.ac.kr", ghost);
      expect((await self.del(`/admin/admins/${r.moderator.id}`)).status).toBe(
        204,
      );
    });

    it("adminGetCatalogStatus reports the last import", async () => {
      const admin = await h.admin();
      const res = (await admin.get("/admin/catalog")).json;
      expect(res.totalCourses).toBe(h.mock.ctx.catalog.courses.length);
      expect(res.lastImport).toMatchObject({
        status: "succeeded",
        coursesTotal: res.totalCourses,
        sourceLabel: "2024-1 … 2026-1",
      });
      expect((await (await h.student()).get("/admin/catalog")).status).toBe(
        403,
      );
      expect((await h.client().get("/admin/catalog")).status).toBe(401);
    });

    it("adminListJobs shows configuration and last runs", async () => {
      const admin = await h.admin();
      const res = (await admin.get("/admin/jobs")).json;
      expect(
        res.items.map((j: { name: string; enabled: boolean }) => [
          j.name,
          j.enabled,
        ]),
      ).toEqual([
        ["retention", true],
        ["archive", true],
        ["upload-gc", false],
      ]);
      expect((await (await h.student()).get("/admin/jobs")).status).toBe(403);
      expect((await h.client().get("/admin/jobs")).status).toBe(401);
    });
  });

  describe("internal", () => {
    const bearer = { authorization: "Bearer mock-cron-secret" };

    it("runJob runs an enabled job with the cron secret", async () => {
      const retention = await h
        .client()
        .post("/internal/jobs/retention", { headers: bearer, origin: null });
      expect(retention.status).toBe(200);
      expect(retention.json).toMatchObject({
        name: "retention",
        status: "succeeded",
      });
      const archive = await h
        .client()
        .post("/internal/jobs/archive", { headers: bearer, origin: null });
      expect(archive.json.affected).toBeGreaterThan(0);
      const admin = await h.admin();
      expect(
        (await admin.get("/admin/logs/archive-runs")).json.items,
      ).toHaveLength(5);
      expect(
        (await admin.get("/admin/jobs")).json.items[1].lastRun.affected,
      ).toBe(archive.json.affected);
    });

    it("runJob refuses bad secrets, disabled and unknown jobs", async () => {
      expect(
        (await h.client().post("/internal/jobs/retention", { origin: null }))
          .status,
      ).toBe(401);
      expect(
        (
          await h.client().post("/internal/jobs/retention", {
            headers: { authorization: "Bearer wrong" },
          })
        ).status,
      ).toBe(401);
      const disabled = await h
        .client()
        .post("/internal/jobs/upload-gc", { headers: bearer });
      expect(disabled.status).toBe(409);
      expect(disabled.json.error.code).toBe("JOB_DISABLED");
      expect(
        (await h.client().post("/internal/jobs/vacuum", { headers: bearer }))
          .status,
      ).toBe(404);
      const unset = h.app({ cronSecret: null });
      expect(
        (
          await h
            .client(unset)
            .post("/internal/jobs/retention", { headers: bearer })
        ).status,
      ).toBe(404);
    });
  });
}
