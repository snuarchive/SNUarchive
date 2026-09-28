// Calls every operation in the contract against the in-process app and checks
// each response (status, media type, body) against openapi.yaml.
import { describe, expect, it } from "vitest";
import { SPEC_PATH, specExists } from "./contract";
import { loadContract, useHarness } from "./harness";
import { adminLogScenarios } from "./scenarios/adminLogs";
import { adminModerationScenarios } from "./scenarios/adminModeration";
import { adminVotingScenarios } from "./scenarios/adminVoting";
import { catalogScenarios } from "./scenarios/catalog";
import { consoleScenarios } from "./scenarios/console";
import { contributeScenarios } from "./scenarios/contribute";
import { malformedScenarios } from "./scenarios/malformed";
import { mockControlScenarios } from "./scenarios/mock";
import { sessionScenarios } from "./scenarios/session";

// test/globalSetup.ts prints how to restore the symlink when it is missing.
describe.skipIf(!specExists)(
  specExists ? "contract" : `contract (skipped: ${SPEC_PATH} not found)`,
  () => {
    const h = useHarness();

    // Guards against a validator that passes everything.
    describe("validator self-check", () => {
      const json = (body: unknown, type = "application/json") => ({
        headers: new Headers({ "content-type": type, "x-request-id": "req_1" }),
        bytes: Buffer.from(JSON.stringify(body)),
      });
      const me = {
        id: 1,
        email: "a@snu.ac.kr",
        isAdmin: false,
        calendar: {
          currentTerm: { year: 2026, semester: 3 },
          timezone: "Asia/Seoul",
        },
      };

      it("accepts a conforming body", async () => {
        const contract = await loadContract();
        expect(
          contract.validate("GET", "/api/v1/me", { status: 200, ...json(me) }),
        ).toEqual([]);
      });

      it("rejects wrong types, enums, formats and missing fields", async () => {
        const contract = await loadContract();
        const check = (body: unknown) =>
          contract.validate("GET", "/api/v1/me", {
            status: 200,
            ...json(body),
          });
        expect(check({ ...me, id: "one" })).not.toEqual([]);
        expect(
          check({
            ...me,
            calendar: {
              ...me.calendar,
              currentTerm: { year: 2026, semester: 5 },
            },
          }),
        ).not.toEqual([]);
        expect(check({ ...me, email: "not-an-email" })).not.toEqual([]);
        expect(check({ ...me, isAdmin: undefined })).not.toEqual([]);
        const stat = {
          id: 1,
          q1: 1,
          q2: 2,
          q3: 3,
          q4: 4,
          average: 2,
          maxScore: 10,
          note: null,
          nickname: "x",
          source: "direct",
          createdAt: "yesterday",
        };
        const created = {
          statistic: stat,
          sitting: {
            id: 1,
            kindId: 1,
            number: null,
            label: "중간",
            term: { year: 2026, semester: 3 },
          },
        };
        expect(
          contract.validate("POST", "/api/v1/courses/1/statistics", {
            status: 201,
            ...json(created),
          }),
        ).not.toEqual([]);
      });

      it("rejects undeclared statuses, media types and error bodies without the request id", async () => {
        const contract = await loadContract();
        expect(
          contract.validate("GET", "/api/v1/me", { status: 418, ...json(me) }),
        ).not.toEqual([]);
        expect(
          contract.validate("GET", "/api/v1/me", {
            status: 200,
            ...json(me, "text/plain"),
          }),
        ).not.toEqual([]);
        const err = {
          error: {
            code: "NOT_AUTHENTICATED",
            message: "x",
            requestId: "other",
          },
        };
        expect(
          contract.validate("GET", "/api/v1/me", { status: 401, ...json(err) }),
        ).not.toEqual([]);
        expect(
          contract.validate("GET", "/api/v1/me", {
            status: 401,
            ...json({
              error: { ...err.error, code: "TEAPOT", requestId: "req_1" },
            }),
          }),
        ).not.toEqual([]);
        expect(
          contract.validate("POST", "/api/v1/auth/logout", {
            status: 204,
            ...json({}),
          }),
        ).not.toEqual([]);
      });
    });

    sessionScenarios(h);
    catalogScenarios(h);
    contributeScenarios(h);
    adminModerationScenarios(h);
    adminVotingScenarios(h);
    adminLogScenarios(h);
    consoleScenarios(h);
    malformedScenarios(h);
    mockControlScenarios(h);

    // Runs last: vitest runs the tests of a file in declaration order.
    describe("coverage", () => {
      it("exercises every operationId in the contract", async () => {
        const contract = await loadContract();
        const missing = contract.operationIds.filter(
          (id) => !contract.covered.has(id),
        );
        expect(missing).toEqual([]);
      });

      it("sees at least one error status for every operation that declares one", async () => {
        const contract = await loadContract();
        const lacking = contract.api
          .getOperations()
          .filter((op) =>
            Object.keys(op.responses ?? {}).some((s) => Number(s) >= 400),
          )
          .map((op) => op.operationId!)
          .filter(
            (id) => ![...(contract.seen.get(id) ?? [])].some((s) => s >= 400),
          );
        expect(lacking).toEqual([]);
      });
    });
  },
);
