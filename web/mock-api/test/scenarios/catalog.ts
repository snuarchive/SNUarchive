import { describe, expect, it } from "vitest";
import { normalize } from "../../src/catalog";
import { barChartPng } from "../../src/files";
import { KIND } from "../../src/refdata";
import type { Client } from "../client";
import type { H } from "../harness";
import { refs, SEED_ACCOUNTS, UNKNOWN_ID } from "../harness";

type Summary = {
  id: number;
  title: string;
  instructor: string;
  departments: string[];
  latestTerm: { year: number; semester: number };
};

export function catalogScenarios(h: H) {
  describe("catalog", () => {
    it("searchCourses matches every token and ranks title prefixes first", async () => {
      const c = await h.student();
      const res = await c.get(
        `/courses?q=${encodeURIComponent("미적분")}&limit=50`,
      );
      expect(res.status).toBe(200);
      const items: Summary[] = res.json.items;
      expect(items.length).toBeGreaterThan(3);
      const prefixed = items.map((x) =>
        normalize(x.title).startsWith("미적분"),
      );
      expect(
        prefixed.indexOf(false) === -1 ||
          prefixed.slice(prefixed.indexOf(false)).every((p) => !p),
      ).toBe(true);

      const both = (
        await c.get(`/courses?q=${encodeURIComponent("선형 대수")}&limit=50`)
      ).json.items as Summary[];
      expect(both.length).toBeGreaterThan(0);
      // Each token within a single field.
      for (const x of both) {
        const fields = h.mock.ctx.catalog.byId.get(x.id)!.searchFields;
        for (const t of ["선형", "대수"])
          expect(fields.some((f) => f.includes(t))).toBe(true);
      }
      // Tokens match inside title, instructor or department, e.g. an instructor name.
      const byInstructor = (
        await c.get(`/courses?q=${encodeURIComponent("미적분 김경선")}`)
      ).json.items as Summary[];
      expect(byInstructor.every((x) => x.instructor === "김경선")).toBe(true);
      // Case- and space-insensitive.
      const spaced = (
        await c.get(`/courses?q=${encodeURIComponent("미 적 분 학")}&limit=5`)
      ).json.items as Summary[];
      expect(spaced.length).toBeGreaterThan(0);
    });

    it("searchCourses pages with opaque cursors and supports ETag", async () => {
      const c = await h.student();
      const first = await c.get("/courses?q=%EC%98%81%EC%96%B4&limit=5");
      expect(first.json.items).toHaveLength(5);
      const etag = first.headers.get("etag")!;
      expect(etag).toBeTruthy();
      const second = await c.get(
        `/courses?q=%EC%98%81%EC%96%B4&limit=5&cursor=${first.json.nextCursor}`,
      );
      expect(second.json.items[0].id).not.toBe(first.json.items[0].id);

      const notModified = await c.get("/courses?q=%EC%98%81%EC%96%B4&limit=5", {
        headers: { "if-none-match": etag },
      });
      expect(notModified.status).toBe(304);
      expect(notModified.bytes.byteLength).toBe(0);

      // A new statistic changes the badges, so the tag changes.
      const r = refs(h.mock);
      await c.post(`/courses/${r.course.id}/statistics`, {
        json: { kindId: 6, year: 2026, semester: 3, average: 50 },
      });
      const after = await c.get("/courses?q=%EC%98%81%EC%96%B4&limit=5", {
        headers: { "if-none-match": etag },
      });
      expect(after.status).toBe(200);
    });

    it("searchCourses rejects bad parameters", async () => {
      const c = await h.student();
      expect((await c.get("/courses")).status).toBe(400);
      expect((await c.get("/courses?q=")).status).toBe(400);
      expect((await c.get(`/courses?q=${"가".repeat(101)}`)).status).toBe(400);
      expect((await c.get("/courses?q=a&limit=51")).status).toBe(400);
      expect((await c.get("/courses?q=a&cursor=%%%")).status).toBe(400);
      expect((await h.client().get("/courses?q=a")).status).toBe(401);
      expect((await c.get("/courses?q=zzzzzzqqqq")).json).toEqual({
        items: [],
        nextCursor: null,
      });
    });

    it("getHomeLists fills four sections", async () => {
      const r = refs(h.mock);
      const res = await (await h.student()).get("/courses/home");
      expect(res.status).toBe(200);
      expect(res.json.favorites[0].id).toBe(r.course.id);
      expect(res.json.votingOpen.length).toBeGreaterThanOrEqual(3);
      expect(
        res.json.votingOpen.every((x: { votingOpen: boolean }) => x.votingOpen),
      ).toBe(true);
      expect(res.json.recentlyUpdated.length).toBeGreaterThan(5);
      expect(res.json.mostRequested[0].openRequestCount).toBeGreaterThanOrEqual(
        res.json.mostRequested.at(-1).openRequestCount,
      );
      const newbie = (
        await (await h.as(SEED_ACCOUNTS.newbie)).get("/courses/home")
      ).json;
      expect(newbie.favorites).toEqual([]);
      expect((await h.client().get("/courses/home")).status).toBe(401);
    });

    it("getHomeLists counts requests only on sittings never opened", async () => {
      const r = refs(h.mock);
      const c = await h.as(SEED_ACCOUNTS.newbie);
      const requested = async () =>
        (await c.get("/courses/home")).json.mostRequested.map(
          (x: { id: number; openRequestCount: number }) => [
            x.id,
            x.openRequestCount,
          ],
        );
      const before = await requested();
      expect(before.some(([id]: number[]) => id === r.course.id)).toBe(false);
      const key = (s: typeof r.closedSitting) => ({
        kindId: s.kindId,
        number: s.number,
        year: s.year,
        semester: s.semester,
      });
      // A closed sitting of the first course: the request is recorded, not counted.
      const closed = h.mock.ctx.state.sittings.find(
        (s) => s.courseId === r.course.id && s.id === r.closedSitting.id,
      )!;
      expect(
        (
          await c.post(`/courses/${r.course.id}/voting-requests`, {
            json: key(closed),
          })
        ).status,
      ).toBe(201);
      expect(await requested()).toEqual(before);
      // A never-opened sitting of the same course counts.
      const never = h.mock.ctx.state.sittings.find(
        (s) => s.courseId === r.course.id && s.votingOpenedAt === null,
      )!;
      await c.post(`/courses/${r.course.id}/voting-requests`, {
        json: key(never),
      });
      expect(await requested()).toContainEqual([r.course.id, 1]);
    });

    it("getHomeLists shows the first 10 favourites in the user's order", async () => {
      const r = refs(h.mock);
      const c = await h.as(SEED_ACCOUNTS.newbie);
      const ids = r.courses.slice(0, 11).map((x) => x.id);
      for (const id of ids) await c.put(`/courses/${id}/favorite`);
      const order = (await c.get("/me/favorites/ids")).json.ids as number[];
      expect(order).toEqual([...ids].reverse());
      const home = (await c.get("/courses/home")).json.favorites.map(
        (x: { id: number }) => x.id,
      );
      expect(home).toEqual(order.slice(0, 10));
    });

    it("getCourse returns the composite page", async () => {
      const r = refs(h.mock);
      const res = await (await h.student()).get(`/courses/${r.course.id}`);
      expect(res.status).toBe(200);
      const course = res.json;
      expect(course.isFavorite).toBe(true);
      expect(course.departments).toEqual([...course.departments].sort());
      const terms = course.offerings.map(
        (o: { year: number; semester: number }) => o.year * 10 + o.semester,
      );
      expect(terms).toEqual([...terms].sort((a: number, b: number) => b - a));
      const sittingTerms = course.sittings.map(
        (s: { term: { year: number; semester: number } }) =>
          s.term.year * 10 + s.term.semester,
      );
      expect(sittingTerms).toEqual(
        [...sittingTerms].sort((a: number, b: number) => b - a),
      );
      const open = course.sittings.find(
        (s: { id: number }) => s.id === r.openSitting.id,
      );
      expect(open.voting.state).toBe("open");
      expect(open.myRating).toEqual(expect.any(Number));
      expect(open.difficulty.distribution).toHaveLength(5);
      expect(course.comments.items).toHaveLength(20);
      expect(course.comments.nextCursor).toEqual(expect.any(String));
      expect(
        course.comments.items.some(
          (x: { author: string | null }) => x.author === null,
        ),
      ).toBe(true);
      expect(
        course.comments.items.some(
          (x: { author: string | null }) => x.author === "김*수",
        ),
      ).toBe(true);

      const empty = (
        await (await h.student()).get(`/courses/${r.emptyCourse.id}`)
      ).json;
      expect(empty.sittings).toEqual([]);
      expect(empty.comments).toEqual({ items: [], nextCursor: null });
    });

    describe("getCourse leaves out empty sittings", () => {
      const listed = async (c: Client, courseId: number) =>
        (await c.get(`/courses/${courseId}`)).json.sittings.map(
          (s: { id: number }) => s.id,
        ) as number[];
      const adminListed = async (c: Client, courseId: number) =>
        (
          await c.get(
            `/admin/sittings?votingState=any&courseId=${courseId}&limit=50`,
          )
        ).json.items.map((s: { id: number }) => s.id) as number[];

      it("hides a sitting whose requests went away and shows it again when used", async () => {
        const r = refs(h.mock);
        const courseId = r.emptyCourse.id;
        const student = await h.student();
        const admin = await h.admin();
        const key = { kindId: KIND.midterm, year: 2026, semester: 3 };
        const url = `/courses/${courseId}/voting-requests`;

        const req = (await student.post(url, { json: key })).json;
        const id: number = req.sitting.id;
        expect(await listed(student, courseId)).toEqual([id]);

        // Cancelled: empty, so left out, but never deleted.
        await student.del(`/voting-requests/${req.id}`);
        expect(await listed(student, courseId)).toEqual([]);
        expect(await adminListed(admin, courseId)).toEqual([id]);
        expect(h.mock.ctx.state.sittings.some((s) => s.id === id)).toBe(true);

        // Requested again: back. Rejected: gone again.
        expect((await student.post(url, { json: key })).status).toBe(201);
        expect(await listed(student, courseId)).toEqual([id]);
        await admin.post(`/admin/voting-requests/${id}/reject`, { json: {} });
        expect(await listed(student, courseId)).toEqual([]);

        // Open voting alone is enough; closed with no votes is empty again.
        await admin.post(`/admin/sittings/${id}/voting`, {
          json: { closesAt: null },
        });
        expect(await listed(student, courseId)).toEqual([id]);
        await admin.post(`/admin/sittings/${id}/voting/close`);
        expect(await listed(student, courseId)).toEqual([]);

        // A vote keeps it after voting closes.
        await admin.post(`/admin/sittings/${id}/voting`, {
          json: { closesAt: null },
        });
        await student.put(`/sittings/${id}/vote`, { json: { rating: 3 } });
        await admin.post(`/admin/sittings/${id}/voting/close`);
        expect(await listed(student, courseId)).toEqual([id]);
      });

      it("counts hidden statistics and forgets a statistic moved away", async () => {
        const r = refs(h.mock);
        const courseId = r.emptyCourse.id;
        const student = await h.student();
        const admin = await h.admin();
        const created = (
          await student.post(`/courses/${courseId}/statistics`, {
            json: { kindId: KIND.final, year: 2026, semester: 3, average: 50 },
          })
        ).json;
        const id: number = created.sitting.id;
        expect(await listed(student, courseId)).toEqual([id]);

        // Hidden still counts as something.
        await admin.put(`/admin/statistics/${created.statistic.id}/hidden`, {
          json: { hidden: true },
        });
        const page = (await student.get(`/courses/${courseId}`)).json;
        expect(page.sittings).toHaveLength(1);
        expect(page.sittings[0]).toMatchObject({ id, statistics: [] });

        // Moved away, the only statistic leaves the sitting empty.
        const moved = await admin.post(
          `/admin/statistics/${created.statistic.id}/move`,
          {
            json: {
              courseId,
              kindId: KIND.midterm,
              year: 2025,
              semester: 3,
            },
          },
        );
        expect(await listed(student, courseId)).toEqual([
          moved.json.sitting.id,
        ]);
        expect(await adminListed(admin, courseId)).toContain(id);
      });

      it("keeps a sitting an admin created, even while empty", async () => {
        const r = refs(h.mock);
        const courseId = r.emptyCourse.id;
        const student = await h.student();
        const admin = await h.admin();
        const url = `/admin/courses/${courseId}/sittings`;
        const fresh = await admin.post(url, {
          json: { kindId: KIND.final, year: 2025, semester: 3 },
        });
        expect(fresh.status).toBe(201);
        expect(await listed(student, courseId)).toEqual([fresh.json.id]);

        // Re-creating an existing, hidden sitting marks it admin-created too.
        const key = { kindId: KIND.quiz, number: 1, year: 2026, semester: 3 };
        const req = (
          await student.post(`/courses/${courseId}/voting-requests`, {
            json: key,
          })
        ).json;
        await student.del(`/voting-requests/${req.id}`);
        expect(await listed(student, courseId)).not.toContain(req.sitting.id);
        const again = await admin.post(url, { json: key });
        expect(again.status).toBe(200);
        expect(again.json.id).toBe(req.sitting.id);
        const page = (await student.get(`/courses/${courseId}`)).json;
        const shown = page.sittings.find(
          (s: { id: number }) => s.id === req.sitting.id,
        );
        // Empty, and listed so students can request voting on it.
        expect(shown).toMatchObject({
          voting: { state: "never" },
          statistics: [],
          difficulty: { voteCount: 0 },
          votingRequests: { openCount: 0, mine: null },
        });
      });

      it("creates a sitting for an upload only when it is approved", async () => {
        const r = refs(h.mock);
        const courseId = r.emptyCourse.id;
        const student = await h.student();
        const admin = await h.admin();
        const form = new FormData();
        form.append("file", new Blob([barChartPng([1, 2, 3])]), "q.png");
        for (const [k, v] of Object.entries({
          kindId: String(KIND.quiz),
          number: "4",
          year: "2026",
          semester: "3",
        }))
          form.append(k, v);
        const before = h.mock.ctx.state.sittings.length;
        const upload = await student.post(`/courses/${courseId}/reports`, {
          form,
        });
        expect(upload.status).toBe(201);
        expect(h.mock.ctx.state.sittings).toHaveLength(before);
        expect(await listed(student, courseId)).toEqual([]);
        expect(await adminListed(admin, courseId)).toEqual([]);

        const approved = await admin.post(
          `/admin/reports/${upload.json.id}/approve`,
          { json: { average: 7 } },
        );
        expect(approved.status).toBe(201);
        expect(h.mock.ctx.state.sittings).toHaveLength(before + 1);
        expect(await listed(student, courseId)).toEqual([
          approved.json.sitting.id,
        ]);
      });

      it("keeps the seeded sittings the E2E suite uses", async () => {
        const r = refs(h.mock);
        const byTitle = (t: string) => r.courses.find((c) => c.title === t)!;
        const student = await h.student();
        const admin = await h.admin();

        const calculus = (
          await student.get(`/courses/${byTitle("미적분학 1").id}`)
        ).json;
        expect(
          calculus.sittings.some(
            (s: { voting: { state: string } }) => s.voting.state === "open",
          ),
        ).toBe(true);

        // 선형대수학 has a never-opened sitting to request voting on. An
        // admin created it, so it stays even once its requests are gone.
        const linear = byTitle("선형대수학");
        const never = h.mock.ctx.state.sittings.find(
          (s) =>
            s.courseId === linear.id &&
            s.votingOpenedAt === null &&
            s.adminCreated,
        )!;
        expect(never).toBeDefined();
        await admin.post(`/admin/voting-requests/${never.id}/reject`, {
          json: {},
        });
        const page = (await student.get(`/courses/${linear.id}`)).json;
        const shown = page.sittings.find(
          (s: { id: number }) => s.id === never.id,
        );
        expect(shown).toMatchObject({
          voting: { state: "never" },
          votingRequests: { openCount: 0, mine: null },
        });

        // Every other seeded sitting has something in it.
        for (const s of h.mock.ctx.state.sittings) {
          expect(
            (await student.get(`/courses/${s.courseId}`)).json.sittings.some(
              (x: { id: number }) => x.id === s.id,
            ),
          ).toBe(true);
        }
      });
    });

    it("getCourse 404s for unknown ids", async () => {
      const c = await h.student();
      expect((await c.get(`/courses/${UNKNOWN_ID}`)).status).toBe(404);
      expect(
        (await h.client().get(`/courses/${refs(h.mock).course.id}`)).status,
      ).toBe(401);
    });

    it("listCourseComments continues after the first page", async () => {
      const r = refs(h.mock);
      const c = await h.student();
      const page = (await c.get(`/courses/${r.course.id}`)).json.comments;
      const next = await c.get(
        `/courses/${r.course.id}/comments?cursor=${page.nextCursor}`,
      );
      expect(next.status).toBe(200);
      expect(next.json.items.length).toBeGreaterThan(0);
      expect(next.json.items[0].id).not.toBe(page.items[0].id);
      expect(next.json.nextCursor).toBeNull();
      expect(
        (await c.get(`/courses/${r.course.id}/comments?cursor=nope`)).status,
      ).toBe(400);
      expect((await c.get(`/courses/${UNKNOWN_ID}/comments`)).status).toBe(404);
      expect(
        (await h.client().get(`/courses/${r.course.id}/comments`)).status,
      ).toBe(401);
    });
  });
}
