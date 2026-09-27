import { describe, expect, it } from "vitest";
import { normalize } from "../../src/catalog";
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
      for (const x of both) {
        const text = h.mock.ctx.catalog.byId.get(x.id)!.searchText;
        expect(text.includes("선형") && text.includes("대수")).toBe(true);
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
