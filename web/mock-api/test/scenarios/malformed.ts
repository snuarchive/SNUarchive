// The contract declares 400 MALFORMED_REQUEST on every JSON write. One pass
// sends each malformed bodies, with valid ids so no 404 comes first.
import { describe, expect, it } from "vitest";
import type { H } from "../harness";
import { refs } from "../harness";

export function malformedScenarios(h: H) {
  describe("malformed bodies", () => {
    it("a required field sent as null is 422 REQUIRED, not 400", async () => {
      const r = refs(h.mock);
      const student = await h.student();
      const res = await student.post(`/courses/${r.course.id}/comments`, {
        json: { body: null },
      });
      expect(res.status).toBe(422);
      expect(res.json.error.details.fields).toEqual([
        { field: "body", code: "REQUIRED" },
      ]);
    });

    it("every JSON write answers 400 to a malformed body", async () => {
      const r = refs(h.mock);
      const admin = await h.admin();
      const writes: [string, string][] = [
        ["POST", "/auth/dev-login"],
        ["PATCH", "/me"],
        ["PUT", "/me/favorites/order"],
        ["POST", `/courses/${r.course.id}/comments`],
        ["POST", `/courses/${r.course.id}/statistics`],
        ["POST", `/courses/${r.course.id}/voting-requests`],
        ["PUT", `/sittings/${r.openSitting.id}/vote`],
        ["POST", `/admin/reports/${r.pendingReport.id}/approve`],
        ["POST", `/admin/reports/${r.pendingReport.id}/reject`],
        ["PATCH", `/admin/statistics/${r.visibleStatistic.id}`],
        ["POST", `/admin/statistics/${r.visibleStatistic.id}/move`],
        ["PUT", `/admin/statistics/${r.visibleStatistic.id}/hidden`],
        ["POST", `/admin/courses/${r.course.id}/sittings`],
        ["POST", `/admin/sittings/${r.neverSitting.id}/voting`],
        ["PATCH", `/admin/sittings/${r.openSitting.id}/voting`],
        ["POST", `/admin/voting-requests/${r.requestedSitting.id}/reject`],
        ["POST", "/admin/logs/delete-preview"],
        ["POST", "/admin/logs/delete"],
        ["POST", "/admin/admins"],
      ];
      for (const [method, path] of writes) {
        // Unparseable, not an object, and an unknown field (the backend
        // reads bodies with DisallowUnknownFields).
        for (const json of ["{", "[1]", `{"unknownField":1}`]) {
          const res = await admin.call(method, path, { json });
          expect([method, path, json, res.status]).toEqual([
            method,
            path,
            json,
            400,
          ]);
          expect(res.json.error.code).toBe("MALFORMED_REQUEST");
        }
      }
    });
  });
}
