import { describe, expect, it } from "vitest";
import { barChartPng } from "../../src/files";
import { KIND } from "../../src/refdata";
import type { H } from "../harness";
import { refs, SEED_ACCOUNTS, UNKNOWN_ID } from "../harness";

type Field = { field: string; code: string };
const fields = (res: { json: { error: { details: { fields: Field[] } } } }) =>
  res.json.error.details.fields;

function uploadForm(
  file: Blob,
  name: string,
  parts: Record<string, string>,
): FormData {
  const form = new FormData();
  form.append("file", file, name);
  for (const [k, v] of Object.entries(parts)) form.append(k, v);
  return form;
}

export function contributeScenarios(h: H) {
  describe("contribute", () => {
    it("createComment masks the byline and checks length", async () => {
      const r = refs(h.mock);
      const c = await h.student();
      const res = await c.post(`/courses/${r.course.id}/comments`, {
        json: { body: "  기출   많이 풀어보세요  " },
      });
      expect(res.status).toBe(201);
      expect(res.json).toMatchObject({
        body: "기출 많이 풀어보세요",
        author: "김*수",
      });
      expect(
        (await c.get(`/courses/${r.course.id}`)).json.comments.items[0].id,
      ).toBe(res.json.id);

      expect(
        fields(
          await c.post(`/courses/${r.course.id}/comments`, {
            json: { body: "   " },
          }),
        ),
      ).toEqual([{ field: "body", code: "REQUIRED" }]);
      expect(
        fields(
          await c.post(`/courses/${r.course.id}/comments`, {
            json: { body: "가".repeat(51) },
          }),
        ),
      ).toEqual([{ field: "body", code: "TOO_LONG" }]);
      expect(
        (
          await c.post(`/courses/${r.course.id}/comments`, {
            json: { body: "가".repeat(50) },
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await c.post(`/courses/${UNKNOWN_ID}/comments`, {
            json: { body: "x" },
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await c.post(`/courses/${r.course.id}/comments`, {
            json: { body: "x" },
            csrf: false,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await h
            .client()
            .post(`/courses/${r.course.id}/comments`, { json: { body: "x" } })
        ).status,
      ).toBe(401);
    });

    it("addFavorite and removeFavorite are idempotent", async () => {
      const r = refs(h.mock);
      const c = await h.as(SEED_ACCOUNTS.newbie);
      expect((await c.put(`/courses/${r.course.id}/favorite`)).status).toBe(
        204,
      );
      expect((await c.put(`/courses/${r.course.id}/favorite`)).status).toBe(
        204,
      );
      expect((await c.get("/me/favorites/ids")).json.ids).toEqual([
        r.course.id,
      ]);
      expect((await c.get(`/courses/${r.course.id}`)).json.isFavorite).toBe(
        true,
      );
      expect((await c.del(`/courses/${r.course.id}/favorite`)).status).toBe(
        204,
      );
      expect((await c.del(`/courses/${r.course.id}/favorite`)).status).toBe(
        204,
      );
      expect((await c.get("/me/favorites/ids")).json.ids).toEqual([]);
      expect((await c.put(`/courses/${UNKNOWN_ID}/favorite`)).status).toBe(404);
      expect((await c.del(`/courses/${UNKNOWN_ID}/favorite`)).status).toBe(404);
      expect(
        (await c.put(`/courses/${r.course.id}/favorite`, { csrf: false }))
          .status,
      ).toBe(403);
      expect(
        (await c.del(`/courses/${r.course.id}/favorite`, { csrf: false }))
          .status,
      ).toBe(403);
      expect(
        (await h.client().put(`/courses/${r.course.id}/favorite`)).status,
      ).toBe(401);
      expect(
        (await h.client().del(`/courses/${r.course.id}/favorite`)).status,
      ).toBe(401);
    });

    it("createStatistic gets or creates the sitting", async () => {
      const r = refs(h.mock);
      const c = await h.student();
      const body = {
        kindId: KIND.quiz,
        number: 4,
        year: 2026,
        semester: 3,
        q1: 3,
        q2: 5,
        q3: 7,
        q4: 10,
        average: 5.5,
        maxScore: 10,
      };
      const first = await c.post(`/courses/${r.course.id}/statistics`, {
        json: body,
      });
      expect(first.status).toBe(201);
      expect(first.json.sitting).toMatchObject({
        label: "퀴즈 4",
        number: 4,
        term: { year: 2026, semester: 3 },
      });
      expect(first.json.statistic).toMatchObject({
        source: "direct",
        nickname: "(익명)",
        q3: 7,
      });
      const second = await c.post(`/courses/${r.course.id}/statistics`, {
        json: { ...body, nickname: " 수학왕 ", note: "재시험 포함" },
      });
      expect(second.json.sitting.id).toBe(first.json.sitting.id);
      expect(second.json.statistic.nickname).toBe("수학왕");
      const page = (await c.get(`/courses/${r.course.id}`)).json;
      const sitting = page.sittings.find(
        (s: { id: number }) => s.id === first.json.sitting.id,
      );
      expect(sitting.statistics.map((s: { id: number }) => s.id)).toEqual([
        second.json.statistic.id,
        first.json.statistic.id,
      ]);
      expect(sitting.voting.state).toBe("never");
      // Note-only is enough.
      expect(
        (
          await c.post(`/courses/${r.course.id}/statistics`, {
            json: { kindId: KIND.other, year: 2025, semester: 1, note: "패스" },
          })
        ).status,
      ).toBe(201);
    });

    it("createStatistic enforces every statistic rule", async () => {
      const r = refs(h.mock);
      const c = await h.student();
      const url = `/courses/${r.course.id}/statistics`;
      const key = { kindId: KIND.midterm, year: 2026, semester: 3 };
      expect(
        fields(await c.post(url, { json: { ...key, q1: 50, q2: 40, q3: 30 } })),
      ).toEqual([{ field: "", code: "QUARTILES_OUT_OF_ORDER" }]);
      expect(
        fields(
          await c.post(url, {
            json: { ...key, q4: 105, average: 101, maxScore: 100 },
          }),
        ),
      ).toEqual([
        { field: "q4", code: "VALUE_ABOVE_MAX_SCORE" },
        { field: "average", code: "VALUE_ABOVE_MAX_SCORE" },
      ]);
      expect(
        fields(
          await c.post(url, {
            json: { ...key, q1: -1, average: 1.234, maxScore: 10000 },
          }),
        ),
      ).toEqual([{ field: "", code: "VALUE_OUT_OF_RANGE" }]);
      expect(
        fields(await c.post(url, { json: { ...key, note: "  " } })),
      ).toEqual([{ field: "", code: "NOTHING_SUBMITTED" }]);
      expect(
        fields(
          await c.post(url, {
            json: { kindId: KIND.quiz, year: 2026, semester: 3, average: 1 },
          }),
        ),
      ).toEqual([{ field: "number", code: "INVALID_ASSESSMENT_NUMBER" }]);
      expect(
        fields(await c.post(url, { json: { ...key, number: 2, average: 1 } })),
      ).toEqual([{ field: "number", code: "INVALID_ASSESSMENT_NUMBER" }]);
      expect(
        fields(
          await c.post(url, {
            json: {
              kindId: KIND.exam,
              number: 7,
              year: 2026,
              semester: 3,
              average: 1,
            },
          }),
        ),
      ).toEqual([{ field: "number", code: "INVALID_ASSESSMENT_NUMBER" }]);
      expect(
        fields(
          await c.post(url, {
            json: { kindId: 99, year: 1970, semester: 3, average: 1 },
          }),
        ),
      ).toEqual([
        { field: "kindId", code: "UNKNOWN_ASSESSMENT_KIND" },
        { field: "year", code: "INVALID_TERM" },
      ]);
      expect(fields(await c.post(url, { json: { average: 1 } }))).toEqual([
        { field: "kindId", code: "REQUIRED" },
        { field: "year", code: "REQUIRED" },
        { field: "semester", code: "REQUIRED" },
      ]);
      expect(
        fields(
          await c.post(url, {
            json: { ...key, average: 1, nickname: "열한글자닉네임입니다요" },
          }),
        ),
      ).toEqual([{ field: "nickname", code: "TOO_LONG" }]);
      expect(
        fields(await c.post(url, { json: { ...key, note: "가".repeat(501) } })),
      ).toEqual([{ field: "note", code: "TOO_LONG" }]);
      expect(
        (
          await c.post(`/courses/${UNKNOWN_ID}/statistics`, {
            json: { ...key, average: 1 },
          })
        ).status,
      ).toBe(404);
      expect(
        (await c.post(url, { json: { ...key, average: 1 }, csrf: false }))
          .status,
      ).toBe(403);
      expect(
        (await h.client().post(url, { json: { ...key, average: 1 } })).status,
      ).toBe(401);
    });

    it("uploadReport sniffs the file and queues it", async () => {
      const r = refs(h.mock);
      const c = await h.student();
      const url = `/courses/${r.course.id}/reports`;
      const png = new Blob([barChartPng([1, 2, 3])], { type: "text/plain" });
      const res = await c.post(url, {
        form: uploadForm(png, "slide.pdf", {
          kindId: "4",
          number: "2",
          year: "2026",
          semester: "3",
          nickname: "제보자",
        }),
      });
      expect(res.status).toBe(201);
      expect(res.json).toMatchObject({
        status: "pending",
        label: "퀴즈 2",
        nickname: "제보자",
        file: { name: "slide.pdf", contentType: "image/png" },
      });
      const admin = await h.admin();
      const queue = (await admin.get("/admin/reports?status=pending&limit=50"))
        .json.items;
      expect(queue.at(-1).id).toBe(res.json.id);

      const svg = new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], {
        type: "image/svg+xml",
      });
      const rejected = await c.post(url, {
        form: uploadForm(svg, "x.svg", {
          kindId: "1",
          year: "2026",
          semester: "3",
        }),
      });
      expect(rejected.status).toBe(415);
      expect(rejected.json.error.code).toBe("FILE_TYPE_REJECTED");

      const big = new Uint8Array(3 * 1024 * 1024 + 1);
      big.set(barChartPng([1]).subarray(0, 8));
      const tooBig = await c.post(url, {
        form: uploadForm(new Blob([big]), "big.png", {
          kindId: "1",
          year: "2026",
          semester: "3",
        }),
      });
      expect(tooBig.status).toBe(413);
      expect(tooBig.json.error.details.limit).toBe(3 * 1024 * 1024);

      // Precedence: 413, then 415, then 422.
      const badFields = { kindId: "99", year: "1970", semester: "9" };
      const bigSvg = new Uint8Array(3 * 1024 * 1024 + 1).fill(0x20);
      bigSvg.set(new TextEncoder().encode("<svg"));
      expect(
        (await c.post(url, { form: uploadForm(new Blob([bigSvg]), "x.svg", badFields) }))
          .status,
      ).toBe(413);
      expect(
        (await c.post(url, { form: uploadForm(svg, "x.svg", badFields) })).status,
      ).toBe(415);
      expect(
        (await c.post(url, { form: uploadForm(png, "x.png", badFields) })).status,
      ).toBe(422);

      // Multipart has no null: an empty `number` part means null.
      const emptyNumber = await c.post(url, {
        form: uploadForm(png, "x.png", {
          kindId: "1",
          number: "",
          year: "2026",
          semester: "3",
        }),
      });
      expect(emptyNumber.status).toBe(201);
      expect(emptyNumber.json).toMatchObject({ number: null, label: "중간" });
      expect(
        (
          await c.post(url, {
            form: uploadForm(png, "x.png", {
              kindId: "one",
              year: "2026",
              semester: "3",
            }),
          })
        ).status,
      ).toBe(400);

      const pdf = new Blob(["%PDF-1.4\n%%EOF\n"]);
      const invalid = await c.post(url, {
        form: uploadForm(pdf, "a.pdf", {
          kindId: "4",
          year: "2026",
          semester: "3",
        }),
      });
      expect(invalid.status).toBe(422);
      expect(fields(invalid)).toEqual([
        { field: "number", code: "INVALID_ASSESSMENT_NUMBER" },
      ]);
      const noFile = new FormData();
      noFile.append("kindId", "1");
      expect(fields(await c.post(url, { form: noFile }))).toEqual([
        { field: "file", code: "REQUIRED" },
        { field: "year", code: "REQUIRED" },
        { field: "semester", code: "REQUIRED" },
      ]);
      expect(
        (
          await c.post(`/courses/${UNKNOWN_ID}/reports`, {
            form: uploadForm(pdf, "a.pdf", {
              kindId: "1",
              year: "2026",
              semester: "3",
            }),
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await c.post(url, {
            form: uploadForm(pdf, "a.pdf", {
              kindId: "1",
              year: "2026",
              semester: "3",
            }),
            csrf: false,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await h
            .client()
            .post(url, {
              form: uploadForm(pdf, "a.pdf", {
                kindId: "1",
                year: "2026",
                semester: "3",
              }),
            })
        ).status,
      ).toBe(401);
    });

    it("createVotingRequest records one open request per person", async () => {
      const r = refs(h.mock);
      const c = await h.as(SEED_ACCOUNTS.newbie);
      const url = `/courses/${r.course.id}/voting-requests`;
      const key = { kindId: KIND.final, year: 2026, semester: 3 };
      const res = await c.post(url, {
        json: { ...key, note: "12월 15일 기말" },
      });
      expect(res.status).toBe(201);
      expect(res.json).toMatchObject({
        status: "open",
        note: "12월 15일 기말",
        sitting: { label: "기말" },
      });
      const again = await c.post(url, { json: key });
      expect(again.status).toBe(409);
      expect(again.json.error.code).toBe("VOTING_REQUEST_EXISTS");
      const page = (await c.get(`/courses/${r.course.id}`)).json;
      const sitting = page.sittings.find(
        (s: { id: number }) => s.id === res.json.sitting.id,
      );
      expect(sitting.votingRequests).toMatchObject({
        openCount: 1,
        mine: { id: res.json.id },
      });

      const s = r.openSitting;
      const open = await c.post(url, {
        json: {
          kindId: s.kindId,
          number: s.number,
          year: s.year,
          semester: s.semester,
        },
      });
      expect(open.status).toBe(409);
      expect(open.json.error.code).toBe("VOTING_ALREADY_OPEN");
      expect(
        fields(
          await c.post(url, {
            json: { ...key, kindId: KIND.midterm, note: "가".repeat(101) },
          }),
        ),
      ).toEqual([{ field: "note", code: "TOO_LONG" }]);
      expect(
        (await c.post(`/courses/${UNKNOWN_ID}/voting-requests`, { json: key }))
          .status,
      ).toBe(404);
      expect((await c.post(url, { json: key, csrf: false })).status).toBe(403);
      expect((await h.client().post(url, { json: key })).status).toBe(401);
    });

    it("cancelVotingRequest withdraws only the owner’s open request", async () => {
      const r = refs(h.mock);
      const c = await h.student();
      expect(
        (await c.del(`/voting-requests/${r.othersOpenRequest.id}`)).json.error
          .code,
      ).toBe("NOT_REQUEST_OWNER");
      expect(
        (
          await c.del(`/voting-requests/${r.studentOpenRequest.id}`, {
            csrf: false,
          })
        ).json.error.code,
      ).toBe("CSRF_INVALID");
      expect(
        (await c.del(`/voting-requests/${r.studentOpenRequest.id}`)).status,
      ).toBe(204);
      const again = await c.del(`/voting-requests/${r.studentOpenRequest.id}`);
      expect(again.status).toBe(409);
      expect(again.json.error.code).toBe("VOTING_REQUEST_NOT_OPEN");
      expect((await c.del(`/voting-requests/${UNKNOWN_ID}`)).status).toBe(404);
      expect(
        (await h.client().del(`/voting-requests/${r.othersOpenRequest.id}`))
          .status,
      ).toBe(401);
      // After cancelling, the same person may ask again.
      const s = r.requestedSitting;
      const course = h.mock.ctx.catalog.byId.get(s.courseId)!;
      const res = await c.post(`/courses/${course.id}/voting-requests`, {
        json: {
          kindId: s.kindId,
          number: s.number,
          year: s.year,
          semester: s.semester,
        },
      });
      expect(res.status).toBe(201);
    });

    it("castVote casts and replaces one vote while voting is open", async () => {
      const r = refs(h.mock);
      const c = await h.as(SEED_ACCOUNTS.newbie);
      const url = `/sittings/${r.openEndedSitting.id}/vote`;
      const before = (await c.put(url, { json: { rating: 5 } })).json;
      expect(before).toMatchObject({
        myRating: 5,
        voting: { state: "open", closesAt: null },
      });
      const after = (await c.put(url, { json: { rating: 1 } })).json;
      expect(after.myRating).toBe(1);
      expect(after.difficulty.voteCount).toBe(before.difficulty.voteCount);
      expect(after.difficulty.distribution[0]).toBe(
        before.difficulty.distribution[0] + 1,
      );
      expect(after.difficulty.distribution[4]).toBe(
        before.difficulty.distribution[4] - 1,
      );

      const closed = await c.put(`/sittings/${r.closedSitting.id}/vote`, {
        json: { rating: 3 },
      });
      expect(closed.status).toBe(409);
      expect(closed.json.error.code).toBe("VOTING_NOT_OPEN");
      expect(
        (
          await c.put(`/sittings/${r.neverSitting.id}/vote`, {
            json: { rating: 3 },
          })
        ).status,
      ).toBe(409);
      expect(fields(await c.put(url, { json: { rating: 6 } }))).toEqual([
        { field: "rating", code: "VALUE_OUT_OF_RANGE" },
      ]);
      expect(
        (await c.put(`/sittings/${UNKNOWN_ID}/vote`, { json: { rating: 3 } }))
          .status,
      ).toBe(404);
      expect(
        (await c.put(url, { json: { rating: 3 }, csrf: false })).status,
      ).toBe(403);
      expect((await h.client().put(url, { json: { rating: 3 } })).status).toBe(
        401,
      );
    });
  });
}
