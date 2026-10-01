import { describe, expect, it } from "vitest";
import { KIND } from "../../src/refdata";
import type { SittingRow } from "../../src/state";
import type { H } from "../harness";
import { refs, SEED_ACCOUNTS, UNKNOWN_ID } from "../harness";

type Field = { field: string; code: string };
const fields = (res: { json: { error: { details: { fields: Field[] } } } }) =>
  res.json.error.details.fields;
const inDays = (d: number) =>
  new Date(Date.now() + d * 86_400_000).toISOString();

export function adminVotingScenarios(h: H) {
  describe("admin-voting", () => {
    it("adminCreateSitting gets or creates, optionally opening voting", async () => {
      const r = refs(h.mock);
      const admin = await h.admin();
      const url = `/admin/courses/${r.course.id}/sittings`;
      const key = { kindId: KIND.exam, number: 1, year: 2026, semester: 3 };
      const created = await admin.post(url, { json: key });
      expect(created.status).toBe(201);
      expect(created.json).toMatchObject({
        label: "1차 시험",
        voting: { state: "never" },
        statisticCount: 0,
        openRequestCount: 0,
      });
      const existing = await admin.post(url, {
        json: { ...key, openVoting: { closesAt: inDays(2) } },
      });
      expect(existing.status).toBe(200);
      expect(existing.json.id).toBe(created.json.id);
      expect(existing.json.voting.state).toBe("open");
      const openEnded = await admin.post(url, {
        json: { ...key, number: 2, openVoting: { closesAt: null } },
      });
      expect(openEnded.status).toBe(201);
      expect(openEnded.json.voting).toMatchObject({
        state: "open",
        closesAt: null,
      });

      const past = await admin.post(url, {
        json: { ...key, number: 3, openVoting: { closesAt: inDays(-1) } },
      });
      expect(fields(past)).toEqual([
        { field: "openVoting.closesAt", code: "CLOSES_AT_IN_PAST" },
      ]);
      // Unknown members are refused at every depth, and the nested object
      // must be an object.
      for (const openVoting of [
        { closesAt: null, closesat: null },
        { closes_at: null },
        null,
        [],
      ]) {
        const res = await admin.post(url, {
          json: { ...key, number: 4, openVoting },
        });
        expect([openVoting, res.status]).toEqual([openVoting, 400]);
        expect(res.json.error.code).toBe("MALFORMED_REQUEST");
      }
      // `closesAt` is required inside `openVoting`.
      expect(
        fields(
          await admin.post(url, {
            json: { ...key, number: 4, openVoting: {} },
          }),
        ),
      ).toEqual([{ field: "openVoting.closesAt", code: "REQUIRED" }]);
      expect(
        (
          await admin.post(`/admin/courses/${UNKNOWN_ID}/sittings`, {
            json: key,
          })
        ).status,
      ).toBe(404);
      expect((await admin.post(url, { json: key, csrf: false })).status).toBe(
        403,
      );
      expect((await (await h.student()).post(url, { json: key })).status).toBe(
        403,
      );
      expect((await h.client().post(url, { json: key })).status).toBe(401);
    });

    it("adminListSittings filters by voting state", async () => {
      const admin = await h.admin();
      const open = (await admin.get("/admin/sittings")).json.items;
      expect(open.length).toBe(3);
      expect(
        open.map(
          (s: { voting: { closesAt: string | null } }) =>
            s.voting.closesAt === null,
        ),
      ).toEqual([false, false, true]);
      expect(Date.parse(open[0].voting.closesAt)).toBeLessThan(
        Date.parse(open[1].voting.closesAt),
      );
      for (const state of ["closed", "never"] as const) {
        const items = (
          await admin.get(`/admin/sittings?votingState=${state}&limit=50`)
        ).json.items;
        expect(items.length).toBeGreaterThan(0);
        expect(
          items.every(
            (s: { voting: { state: string } }) => s.voting.state === state,
          ),
        ).toBe(true);
      }
      const any = (await admin.get("/admin/sittings?votingState=any&limit=50"))
        .json.items;
      expect(any.length).toBe(h.mock.ctx.state.sittings.length);
      const r = refs(h.mock);
      const mine = (
        await admin.get(
          `/admin/sittings?votingState=any&courseId=${r.course.id}`,
        )
      ).json.items;
      expect(
        mine.every(
          (s: { course: { id: number } }) => s.course.id === r.course.id,
        ),
      ).toBe(true);
      expect((await admin.get("/admin/sittings?votingState=soon")).status).toBe(
        400,
      );
      expect((await (await h.student()).get("/admin/sittings")).status).toBe(
        403,
      );
      expect((await h.client().get("/admin/sittings")).status).toBe(401);
    });

    it("adminListSittings orders each voting state as the contract says", async () => {
      const admin = await h.admin();
      const list = async (state: string): Promise<SittingRow[]> =>
        (
          await admin.get(`/admin/sittings?votingState=${state}&limit=50`)
        ).json.items.map((s: { id: number }) =>
          h.mock.ctx.state.sittings.find((x) => x.id === s.id)!,
        );
      const descending = (xs: number[]) =>
        expect(xs).toEqual([...xs].sort((a, b) => b - a));

      // closed: most recently closed or ended first.
      const closed = await list("closed");
      expect(closed.length).toBeGreaterThan(2);
      descending(
        closed.map((s: SittingRow) => s.votingEndedAt ?? s.votingClosesAt!),
      );
      // Closing one now puts it at the top.
      const r = refs(h.mock);
      await admin.post(`/admin/sittings/${r.openSitting.id}/voting/close`);
      expect((await list("closed"))[0].id).toBe(r.openSitting.id);

      // never and any: most recently created first.
      for (const state of ["never", "any"]) {
        const items = await list(state);
        expect(items.length).toBeGreaterThan(2);
        descending(items.map((s: SittingRow) => s.createdAt));
      }
      const created = await admin.post(
        `/admin/courses/${r.course.id}/sittings`,
        { json: { kindId: KIND.other, year: 2026, semester: 3 } },
      );
      expect((await list("never"))[0].id).toBe(created.json.id);
      expect((await list("any"))[0].id).toBe(created.json.id);
    });

    it("adminOpenVoting opens and fulfils the requests", async () => {
      const r = refs(h.mock);
      const admin = await h.admin();
      const s = r.requestedSitting;
      const res = await admin.post(`/admin/sittings/${s.id}/voting`, {
        json: { closesAt: inDays(3) },
      });
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({
        state: "open",
        isOpen: true,
        endedAt: null,
      });
      const student = await h.student();
      const page = (await student.get(`/courses/${s.courseId}`)).json;
      const sitting = page.sittings.find((x: { id: number }) => x.id === s.id);
      expect(sitting.votingRequests).toEqual({ openCount: 0, mine: null });
      expect(
        (await student.put(`/sittings/${s.id}/vote`, { json: { rating: 4 } }))
          .status,
      ).toBe(200);
      expect(
        h.mock.ctx.state.votingRequests.find(
          (x) => x.id === r.studentOpenRequest.id,
        )!.status,
      ).toBe("fulfilled");

      const again = await admin.post(`/admin/sittings/${s.id}/voting`, {
        json: { closesAt: null },
      });
      expect(again.status).toBe(409);
      expect(again.json.error.code).toBe("VOTING_ALREADY_OPEN");
      expect(
        fields(
          await admin.post(`/admin/sittings/${r.neverSitting.id}/voting`, {
            json: { closesAt: inDays(-1) },
          }),
        ),
      ).toEqual([{ field: "closesAt", code: "CLOSES_AT_IN_PAST" }]);
      expect(
        fields(
          await admin.post(`/admin/sittings/${r.neverSitting.id}/voting`, {
            json: {},
          }),
        ),
      ).toEqual([{ field: "closesAt", code: "REQUIRED" }]);
      // Reopening a closed sitting keeps its votes.
      const closed = r.closedSitting;
      const before = (
        await admin.get(
          `/admin/sittings?votingState=any&courseId=${closed.courseId}&limit=50`,
        )
      ).json.items.find((x: { id: number }) => x.id === closed.id);
      const reopened = await admin.post(`/admin/sittings/${closed.id}/voting`, {
        json: { closesAt: null },
      });
      expect(reopened.json.state).toBe("open");
      const after = (
        await admin.get(`/admin/sittings?votingState=open&limit=50`)
      ).json.items.find((x: { id: number }) => x.id === closed.id);
      expect(after.difficulty.voteCount).toBe(before.difficulty.voteCount);
      expect(
        (
          await admin.post(`/admin/sittings/${UNKNOWN_ID}/voting`, {
            json: { closesAt: null },
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await h.client().post(`/admin/sittings/${s.id}/voting`, {
            json: { closesAt: null },
          })
        ).status,
      ).toBe(401);
    });

    it("adminUpdateVoting changes the deadline of open voting", async () => {
      const r = refs(h.mock);
      const admin = await h.admin();
      const url = `/admin/sittings/${r.openSitting.id}/voting`;
      const later = inDays(10);
      expect(
        (await admin.patch(url, { json: { closesAt: later } })).json.closesAt,
      ).toBe(later);
      expect(
        (await admin.patch(url, { json: { closesAt: null } })).json,
      ).toMatchObject({ state: "open", closesAt: null });
      expect(
        fields(await admin.patch(url, { json: { closesAt: inDays(-2) } })),
      ).toEqual([{ field: "closesAt", code: "CLOSES_AT_IN_PAST" }]);
      const closed = await admin.patch(
        `/admin/sittings/${r.closedSitting.id}/voting`,
        { json: { closesAt: later } },
      );
      expect(closed.status).toBe(409);
      expect(closed.json.error.code).toBe("VOTING_NOT_OPEN");
      expect(
        (
          await admin.patch(`/admin/sittings/${UNKNOWN_ID}/voting`, {
            json: { closesAt: null },
          })
        ).status,
      ).toBe(404);
      expect(
        (await h.client().patch(url, { json: { closesAt: null } })).status,
      ).toBe(401);
    });

    it("adminCloseVoting closes now", async () => {
      const r = refs(h.mock);
      const admin = await h.admin();
      const url = `/admin/sittings/${r.openSitting.id}/voting/close`;
      const res = await admin.post(url);
      expect(res.json).toMatchObject({
        state: "closed",
        isOpen: false,
        endedAt: expect.any(String),
      });
      expect((await admin.post(url)).json.error.code).toBe("VOTING_NOT_OPEN");
      const vote = await (
        await h.as(SEED_ACCOUNTS.newbie)
      ).put(`/sittings/${r.openSitting.id}/vote`, { json: { rating: 2 } });
      expect(vote.status).toBe(409);
      expect(
        (await admin.post(`/admin/sittings/${UNKNOWN_ID}/voting/close`)).status,
      ).toBe(404);
      expect((await (await h.student()).post(url)).status).toBe(403);
      expect((await h.client().post(url)).status).toBe(401);
    });

    it("every vote counts: there is no vote cutoff", async () => {
      const r = refs(h.mock);
      const admin = await h.admin();
      // The route is gone (not in the contract, so unchecked).
      const gone = await admin.put(
        `/api/v1/admin/sittings/${r.openSitting.id}/vote-cutoff`,
        { json: { countVotesFrom: null }, unchecked: true },
      );
      expect(gone.status).toBe(404);
      for (const s of h.mock.ctx.state.sittings) {
        const votes = h.mock.ctx.state.votes.filter(
          (v) => v.sittingId === s.id,
        );
        if (!votes.length) continue;
        const item = (
          await admin.get(
            `/admin/sittings?votingState=any&courseId=${s.courseId}&limit=50`,
          )
        ).json.items.find((x: { id: number }) => x.id === s.id);
        expect(item.difficulty.voteCount).toBe(votes.length);
        expect(item.voting).not.toHaveProperty("countedFrom");
      }
    });

    it("adminListVotingRequests groups open requests, most requested first", async () => {
      const admin = await h.admin();
      const res = await admin.get("/admin/voting-requests");
      expect(res.status).toBe(200);
      const counts = res.json.items.map(
        (g: { openCount: number }) => g.openCount,
      );
      expect(counts).toEqual([...counts].sort((a: number, b: number) => b - a));
      expect(counts[0]).toBe(4);
      expect(res.json.items[0].notes.length).toBeGreaterThan(0);
      const paged = await admin.get("/admin/voting-requests?limit=1");
      expect(paged.json.nextCursor).toEqual(expect.any(String));
      expect((await admin.get("/admin/voting-requests?limit=x")).status).toBe(
        400,
      );
      expect(
        (await (await h.student()).get("/admin/voting-requests")).status,
      ).toBe(403);
      expect((await h.client().get("/admin/voting-requests")).status).toBe(401);
    });

    it("adminRejectVotingRequests rejects every open request on a sitting", async () => {
      const r = refs(h.mock);
      const admin = await h.admin();
      const s = r.requestedSitting;
      expect(
        fields(
          await admin.post(`/admin/voting-requests/${s.id}/reject`, {
            json: { note: "가".repeat(501) },
          }),
        ),
      ).toEqual([{ field: "note", code: "TOO_LONG" }]);
      const res = await admin.post(`/admin/voting-requests/${s.id}/reject`, {
        json: { note: "시험 일정 미정" },
      });
      expect(res.json.rejected).toBe(4);
      expect(
        (
          await admin.post(`/admin/voting-requests/${s.id}/reject`, {
            json: {},
          })
        ).json.rejected,
      ).toBe(0);
      const groups = (await admin.get("/admin/voting-requests")).json.items;
      expect(
        groups.some((g: { sitting: { id: number } }) => g.sitting.id === s.id),
      ).toBe(false);
      // A rejected requester may ask again.
      const student = await h.student();
      const again = await student.post(
        `/courses/${s.courseId}/voting-requests`,
        {
          json: {
            kindId: s.kindId,
            number: s.number,
            year: s.year,
            semester: s.semester,
          },
        },
      );
      expect(again.status).toBe(201);
      expect(
        (
          await admin.post(`/admin/voting-requests/${UNKNOWN_ID}/reject`, {
            json: {},
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await h
            .client()
            .post(`/admin/voting-requests/${s.id}/reject`, { json: {} })
        ).status,
      ).toBe(401);
    });
  });
}
