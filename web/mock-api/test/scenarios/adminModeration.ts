import { describe, expect, it } from "vitest";
import { barChartPng } from "../../src/files";
import { KIND } from "../../src/refdata";
import type { H } from "../harness";
import { refs, UNKNOWN_ID } from "../harness";

type Field = { field: string; code: string };
const fields = (res: { json: { error: { details: { fields: Field[] } } } }) =>
  res.json.error.details.fields;

export function adminModerationScenarios(h: H) {
  describe("admin-moderation", () => {
    it("admin routes refuse students and anonymous callers", async () => {
      const student = await h.student();
      const res = await student.get("/admin/reports");
      expect(res.status).toBe(403);
      expect(res.json.error.code).toBe("ADMIN_REQUIRED");
      expect((await h.client().get("/admin/reports")).status).toBe(401);
      const r = refs(h.mock);
      expect(
        (
          await student.post(`/admin/reports/${r.pendingReport.id}/reject`, {
            json: {},
          })
        ).json.error.code,
      ).toBe("ADMIN_REQUIRED");
    });

    it("adminListReports filters and orders the queue", async () => {
      const r = refs(h.mock);
      const admin = await h.admin();
      const pending = (await admin.get("/admin/reports")).json.items;
      expect(pending.length).toBe(3);
      const times = pending.map((x: { createdAt: string }) =>
        Date.parse(x.createdAt),
      );
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(pending[0].fileUrl).toBe(
        `/api/v1/admin/reports/${pending[0].id}/file`,
      );
      const all = (await admin.get("/admin/reports?status=all")).json.items;
      expect(all.map((x: { status: string }) => x.status).sort()).toEqual([
        "approved",
        "pending",
        "pending",
        "pending",
        "rejected",
      ]);
      const approved = (await admin.get("/admin/reports?status=approved")).json
        .items[0];
      expect(approved).toMatchObject({
        linkedStatisticId: expect.any(Number),
        reviewer: { id: r.admin.id },
      });
      const forCourse = (
        await admin.get(`/admin/reports?status=all&courseId=${r.course.id}`)
      ).json.items;
      expect(
        forCourse.every(
          (x: { course: { id: number } }) => x.course.id === r.course.id,
        ),
      ).toBe(true);
      expect((await admin.get("/admin/reports?status=weird")).status).toBe(400);
    });

    it("adminGetReportFile streams the file with sandbox headers", async () => {
      const r = refs(h.mock);
      const admin = await h.admin();
      const res = await admin.get(`/admin/reports/${r.pendingReport.id}/file`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe(r.pendingReport.contentType);
      expect(res.headers.get("content-disposition")).toMatch(/^inline/);
      expect(res.headers.get("content-security-policy")).toBe(
        "sandbox; default-src 'none'; img-src 'self'; object-src 'self'",
      );
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.bytes.byteLength).toBe(r.pendingReport.bytes.byteLength);
      const download = await admin.get(
        `/admin/reports/${r.pendingReport.id}/file?download=1`,
      );
      expect(download.headers.get("content-disposition")).toMatch(
        /^attachment/,
      );
      const pdf = h.mock.ctx.state.reports.find(
        (x) => x.contentType === "application/pdf",
      )!;
      expect(
        Buffer.from((await admin.get(`/admin/reports/${pdf.id}/file`)).bytes)
          .subarray(0, 5)
          .toString(),
      ).toBe("%PDF-");
      expect(
        (await admin.get(`/admin/reports/${UNKNOWN_ID}/file`)).status,
      ).toBe(404);
      expect(
        (
          await (
            await h.student()
          ).get(`/admin/reports/${r.pendingReport.id}/file`)
        ).status,
      ).toBe(403);
      expect(
        (await h.client().get(`/admin/reports/${r.pendingReport.id}/file`))
          .status,
      ).toBe(401);
    });

    it("adminApproveReport transcribes into exactly one statistic", async () => {
      const r = refs(h.mock);
      const admin = await h.admin();
      const report = r.pendingReport;
      const res = await admin.post(`/admin/reports/${report.id}/approve`, {
        json: {
          q1: 40,
          q2: 55,
          q3: 70,
          q4: 95,
          average: 58.5,
          maxScore: 100,
          reviewNote: "판독 완료",
        },
      });
      expect(res.status).toBe(201);
      expect(res.json.statistic).toMatchObject({
        source: "transcribed",
        nickname: report.nickname,
        q2: 55,
      });
      expect(res.json.report).toMatchObject({
        status: "approved",
        linkedStatisticId: res.json.statistic.id,
        reviewer: { id: r.admin.id },
        uploader: { id: report.uploaderId },
      });
      expect(res.json.sitting).toMatchObject({
        kindId: report.kindId,
        term: { year: report.year, semester: report.semester },
      });
      const stats = (
        await admin.get(
          `/admin/statistics?courseId=${report.courseId}&limit=50`,
        )
      ).json.items;
      const created = stats.find(
        (s: { id: number }) => s.id === res.json.statistic.id,
      );
      expect(created).toMatchObject({
        contributor: { id: report.uploaderId },
        sourceReportId: report.id,
      });
      const page = (await admin.get(`/courses/${report.courseId}`)).json;
      expect(
        page.sittings.flatMap((s: { statistics: { id: number }[] }) =>
          s.statistics.map((x) => x.id),
        ),
      ).toContain(res.json.statistic.id);

      const twice = await admin.post(`/admin/reports/${report.id}/approve`, {
        json: { average: 1 },
      });
      expect(twice.status).toBe(409);
      expect(twice.json.error.code).toBe("REPORT_ALREADY_REVIEWED");
    });

    it("adminApproveReport overrides the claimed sitting and validates figures", async () => {
      const r = refs(h.mock);
      const admin = await h.admin();
      const report = h.mock.ctx.state.reports.filter(
        (x) => x.status === "pending",
      )[1];
      expect(report.number).not.toBeNull();
      // An omitted number keeps the claimed one, which an unnumbered kind refuses.
      expect(
        fields(
          await admin.post(`/admin/reports/${report.id}/approve`, {
            json: { kindId: KIND.midterm, average: 1 },
          }),
        ),
      ).toEqual([{ field: "number", code: "INVALID_ASSESSMENT_NUMBER" }]);
      // The override is flat: an unknown or nested field is malformed.
      for (const json of [
        { sitting: { kindId: KIND.quiz }, average: 1 },
        { kindID: KIND.quiz, average: 1 },
      ])
        expect(
          (await admin.post(`/admin/reports/${report.id}/approve`, { json }))
            .status,
        ).toBe(400);
      const override = await admin.post(`/admin/reports/${report.id}/approve`, {
        json: { kindId: KIND.quiz, number: 5, average: 7, maxScore: 10 },
      });
      expect(override.status).toBe(201);
      expect(override.json.sitting).toMatchObject({
        label: "퀴즈 5",
        number: 5,
      });
      // Precedence: 404, then 409, then 422.
      const invalid = { q1: 9, q2: 1 };
      expect(
        (
          await admin.post(`/admin/reports/${UNKNOWN_ID}/approve`, {
            json: invalid,
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await admin.post(`/admin/reports/${report.id}/approve`, {
            json: invalid,
          })
        ).json.error.code,
      ).toBe("REPORT_ALREADY_REVIEWED");

      // `number: null` clears the claimed number explicitly.
      const form = new FormData();
      form.append("file", new Blob([barChartPng([1, 2])]), "q.png");
      for (const [k, v] of Object.entries({
        kindId: String(KIND.quiz),
        number: "2",
        year: "2026",
        semester: "3",
      }))
        form.append(k, v);
      const upload = (
        await (
          await h.student()
        ).post(`/courses/${r.course.id}/reports`, {
          form,
        })
      ).json;
      const cleared = await admin.post(`/admin/reports/${upload.id}/approve`, {
        json: { kindId: KIND.midterm, number: null, average: 1 },
      });
      expect(cleared.status).toBe(201);
      expect(cleared.json.sitting).toMatchObject({
        label: "중간",
        number: null,
      });

      // Only the fields present override; the rest of the claim is kept.
      const partial = new FormData();
      partial.append("file", new Blob([barChartPng([1, 2])]), "q.png");
      for (const [k, v] of Object.entries({
        kindId: String(KIND.quiz),
        number: "2",
        year: "2026",
        semester: "3",
      }))
        partial.append(k, v);
      const claimed = (
        await (
          await h.student()
        ).post(`/courses/${r.course.id}/reports`, { form: partial })
      ).json;
      const yearOnly = await admin.post(
        `/admin/reports/${claimed.id}/approve`,
        { json: { year: 2025, average: 1 } },
      );
      expect(yearOnly.status).toBe(201);
      expect(yearOnly.json.sitting).toMatchObject({
        kindId: KIND.quiz,
        number: 2,
        term: { year: 2025, semester: 3 },
      });

      const pending = r.pendingReport;
      expect(
        fields(
          await admin.post(`/admin/reports/${pending.id}/approve`, {
            json: invalid,
          }),
        ),
      ).toEqual([{ field: "", code: "QUARTILES_OUT_OF_ORDER" }]);
      expect(
        fields(
          await admin.post(`/admin/reports/${pending.id}/approve`, {
            json: { number: 3, average: 1 },
          }),
        ),
      ).toEqual([{ field: "number", code: "INVALID_ASSESSMENT_NUMBER" }]);
      expect(
        (
          await admin.post(`/admin/reports/${UNKNOWN_ID}/approve`, {
            json: { average: 1 },
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await admin.post(`/admin/reports/${pending.id}/approve`, {
            json: { average: 1 },
            csrf: false,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await h.client().post(`/admin/reports/${pending.id}/approve`, {
            json: { average: 1 },
          })
        ).status,
      ).toBe(401);
    });

    it("adminRejectReport closes the upload", async () => {
      const r = refs(h.mock);
      const admin = await h.admin();
      expect(
        fields(
          await admin.post(`/admin/reports/${r.pendingReport.id}/reject`, {
            json: { reviewNote: "가".repeat(501) },
          }),
        ),
      ).toEqual([{ field: "reviewNote", code: "TOO_LONG" }]);
      const res = await admin.post(
        `/admin/reports/${r.pendingReport.id}/reject`,
        { json: { reviewNote: "흐림" } },
      );
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({
        status: "rejected",
        reviewNote: "흐림",
        linkedStatisticId: null,
      });
      expect(
        (
          await admin.post(`/admin/reports/${r.pendingReport.id}/reject`, {
            json: {},
          })
        ).json.error.code,
      ).toBe("REPORT_ALREADY_REVIEWED");
      expect(
        (await admin.post(`/admin/reports/${UNKNOWN_ID}/reject`, { json: {} }))
          .status,
      ).toBe(404);
      expect(
        (
          await h
            .client()
            .post(`/admin/reports/${r.pendingReport.id}/reject`, { json: {} })
        ).status,
      ).toBe(401);
    });

    it("adminListStatistics includes hidden rows, marked", async () => {
      const r = refs(h.mock);
      const admin = await h.admin();
      const hidden = (await admin.get("/admin/statistics?hidden=true")).json
        .items;
      expect(hidden.map((x: { id: number }) => x.id)).toEqual([
        r.hiddenStatistic.id,
      ]);
      expect(hidden[0]).toMatchObject({
        hiddenReason: expect.any(String),
        hiddenAt: expect.any(String),
      });
      const all = (await admin.get("/admin/statistics?limit=50")).json;
      expect(all.items.length).toBe(h.mock.ctx.state.statistics.length);
      const visible = (
        await admin.get("/admin/statistics?hidden=false&limit=50")
      ).json.items;
      expect(visible.length).toBe(all.items.length - 1);
      expect((await admin.get("/admin/statistics?hidden=maybe")).status).toBe(
        400,
      );
      expect((await admin.get("/admin/statistics?courseId=abc")).status).toBe(
        400,
      );
      expect((await (await h.student()).get("/admin/statistics")).status).toBe(
        403,
      );
      expect((await h.client().get("/admin/statistics")).status).toBe(401);
    });

    it("adminUpdateStatistic corrects figures under the same rules", async () => {
      const r = refs(h.mock);
      const admin = await h.admin();
      const url = `/admin/statistics/${r.visibleStatistic.id}`;
      const res = await admin.patch(url, {
        json: { average: 44.5, note: null, nickname: "정정됨" },
      });
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({
        average: 44.5,
        note: null,
        nickname: "정정됨",
        q1: r.visibleStatistic.q1,
      });
      const cleared = await admin.patch(url, { json: { q1: null } });
      expect(cleared.json.q1).toBeNull();
      // An absent field is left unchanged; null clears it.
      const noted = await admin.patch(url, { json: { note: "분반 기준" } });
      expect(noted.json).toMatchObject({
        note: "분반 기준",
        average: 44.5,
        q1: null,
        nickname: "정정됨",
      });
      const kept = await admin.patch(url, { json: { average: 45 } });
      expect(kept.json).toMatchObject({
        note: "분반 기준",
        average: 45,
        nickname: "정정됨",
      });
      // A null or blank nickname becomes the anonymous one.
      expect(
        (await admin.patch(url, { json: { nickname: null } })).json.nickname,
      ).toBe("(익명)");
      expect(
        (await admin.patch(url, { json: { nickname: "  " } })).json.nickname,
      ).toBe("(익명)");
      expect(fields(await admin.patch(url, { json: { q4: 1 } }))).toEqual([
        { field: "", code: "QUARTILES_OUT_OF_ORDER" },
      ]);
      expect(fields(await admin.patch(url, { json: {} }))).toEqual([
        { field: "", code: "REQUIRED" },
      ]);
      expect(
        (
          await admin.patch(`/admin/statistics/${UNKNOWN_ID}`, {
            json: { average: 1 },
          })
        ).status,
      ).toBe(404);
      expect(
        (await admin.patch(url, { json: { average: 1 }, csrf: false })).status,
      ).toBe(403);
      expect(
        (await h.client().patch(url, { json: { average: 1 } })).status,
      ).toBe(401);
    });

    it("adminMoveStatistic re-files a statistic, creating the sitting", async () => {
      const r = refs(h.mock);
      const admin = await h.admin();
      const target = r.courses[5];
      const url = `/admin/statistics/${r.visibleStatistic.id}/move`;
      const res = await admin.post(url, {
        json: {
          courseId: target.id,
          kindId: KIND.exam,
          number: 3,
          year: 2025,
          semester: 3,
        },
      });
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({
        course: { id: target.id },
        sitting: { label: "3차 시험", term: { year: 2025, semester: 3 } },
      });
      const page = (await admin.get(`/courses/${target.id}`)).json;
      expect(
        page.sittings.some((s: { id: number }) => s.id === res.json.sitting.id),
      ).toBe(true);
      expect(
        (
          await admin.post(url, {
            json: {
              courseId: UNKNOWN_ID,
              kindId: KIND.midterm,
              year: 2025,
              semester: 3,
            },
          })
        ).status,
      ).toBe(404);
      expect(
        fields(
          await admin.post(url, {
            json: {
              courseId: target.id,
              kindId: KIND.exam,
              year: 2025,
              semester: 5,
            },
          }),
        ),
      ).toEqual([
        { field: "number", code: "INVALID_ASSESSMENT_NUMBER" },
        { field: "semester", code: "INVALID_TERM" },
      ]);
      expect(
        (
          await admin.post(`/admin/statistics/${UNKNOWN_ID}/move`, {
            json: { courseId: target.id, kindId: 1, year: 2025, semester: 3 },
          })
        ).status,
      ).toBe(404);
      expect((await h.client().post(url, { json: {} })).status).toBe(401);
    });

    it("adminSetStatisticHidden withdraws and restores a row", async () => {
      const r = refs(h.mock);
      const admin = await h.admin();
      const st = r.visibleStatistic;
      const sitting = h.mock.ctx.state.sittings.find(
        (s) => s.id === st.sittingId,
      )!;
      const visibleIds = async () =>
        (await admin.get(`/courses/${sitting.courseId}`)).json.sittings.flatMap(
          (s: { statistics: { id: number }[] }) =>
            s.statistics.map((x) => x.id),
        );
      const hide = await admin.put(`/admin/statistics/${st.id}/hidden`, {
        json: { hidden: true, reason: "중복 제보" },
      });
      expect(hide.json).toMatchObject({
        hiddenReason: "중복 제보",
        hiddenAt: expect.any(String),
      });
      expect(await visibleIds()).not.toContain(st.id);
      const show = await admin.put(`/admin/statistics/${st.id}/hidden`, {
        json: { hidden: false, reason: "ignored" },
      });
      expect(show.json).toMatchObject({ hiddenReason: null, hiddenAt: null });
      expect(await visibleIds()).toContain(st.id);
      expect(
        fields(
          await admin.put(`/admin/statistics/${st.id}/hidden`, {
            json: { hidden: true, reason: "가".repeat(501) },
          }),
        ),
      ).toEqual([{ field: "reason", code: "TOO_LONG" }]);
      // A missing or null `hidden` is a missing required field.
      for (const json of [{}, { hidden: null }, { reason: "x" }])
        expect(
          fields(
            await admin.put(`/admin/statistics/${st.id}/hidden`, { json }),
          ),
        ).toEqual([{ field: "hidden", code: "REQUIRED" }]);
      expect(
        (
          await admin.put(`/admin/statistics/${st.id}/hidden`, {
            json: { hidden: "yes" },
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await admin.put(`/admin/statistics/${UNKNOWN_ID}/hidden`, {
            json: { hidden: true },
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await admin.put(`/admin/statistics/${st.id}/hidden`, {
            json: { hidden: true },
            csrf: false,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await h.client().put(`/admin/statistics/${st.id}/hidden`, {
            json: { hidden: true },
          })
        ).status,
      ).toBe(401);
    });

    it("adminSetStatisticHidden stores a blank reason as null and trims the rest", async () => {
      const r = refs(h.mock);
      const admin = await h.admin();
      const url = `/admin/statistics/${r.visibleStatistic.id}/hidden`;
      const cases: [string | null | undefined, string | null][] = [
        ["", null],
        ["   ", null],
        ["\n\t", null],
        [null, null],
        [undefined, null],
        // Length counts after trimming, so this is exactly the limit.
        [` ${"가".repeat(500)} `, "가".repeat(500)],
        ["  중복 제보 ", "중복 제보"],
      ];
      for (const [reason, stored] of cases) {
        const res = await admin.put(url, {
          json:
            reason === undefined ? { hidden: true } : { hidden: true, reason },
        });
        expect([reason, res.status]).toEqual([reason, 200]);
        expect(res.json).toMatchObject({
          hiddenReason: stored,
          hiddenAt: expect.any(String),
        });
        await admin.put(url, { json: { hidden: false } });
      }
      // Ignored when showing again, however long.
      const shown = await admin.put(url, {
        json: { hidden: false, reason: "가".repeat(501) },
      });
      expect(shown.status).toBe(200);
      expect(shown.json.hiddenReason).toBeNull();
    });

    it("adminListComments and adminDeleteComment moderate comments", async () => {
      const r = refs(h.mock);
      const admin = await h.admin();
      const feed = (await admin.get("/admin/comments")).json;
      expect(feed.items).toHaveLength(20);
      expect(feed.nextCursor).toEqual(expect.any(String));
      const target = (
        await admin.get(`/admin/comments?courseId=${r.course.id}`)
      ).json.items[0];
      expect(target.course.id).toBe(r.course.id);
      expect((await admin.del(`/admin/comments/${target.id}`)).status).toBe(
        204,
      );
      expect(
        (await admin.get(`/courses/${r.course.id}`)).json.comments.items[0].id,
      ).not.toBe(target.id);
      expect((await admin.del(`/admin/comments/${target.id}`)).status).toBe(
        404,
      );
      const logs = (await admin.get("/admin/logs?action=comment_delete")).json
        .items;
      expect(logs[0].metadata.body).toBe(target.body);
      expect((await admin.get("/admin/comments?cursor=zzz")).status).toBe(400);
      expect(
        (await (await h.student()).del(`/admin/comments/${target.id}`)).status,
      ).toBe(403);
      expect(
        (await h.client().del(`/admin/comments/${target.id}`)).status,
      ).toBe(401);
      expect((await h.client().get("/admin/comments")).status).toBe(401);
      expect((await (await h.student()).get("/admin/comments")).status).toBe(
        403,
      );
    });
  });
}
