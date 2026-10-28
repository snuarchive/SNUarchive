import { describe, expect, it } from "vitest";

import { errorMessage, failureText, fieldErrors, formMessage } from "./errors";

const invalid = { code: "VALIDATION_FAILED" as const, message: "x" };

describe("fieldErrors", () => {
  it("keys messages by field, first one winning", () => {
    expect(
      fieldErrors([
        { field: "q2", code: "VALUE_ABOVE_MAX_SCORE" },
        { field: "q2", code: "VALUE_OUT_OF_RANGE" },
      ]),
    ).toEqual({ q2: "만점보다 클 수 없습니다." });
  });
});

describe("formMessage", () => {
  it("uses a whole-body field error for the form", () => {
    expect(
      formMessage(invalid, [{ field: "", code: "QUARTILES_OUT_OF_ORDER" }]),
    ).toBe("Q1 ≤ Q2 ≤ Q3 ≤ Q4 순서여야 합니다.");
  });

  it("falls back to the code's wording", () => {
    expect(formMessage(invalid, [{ field: "q1", code: "REQUIRED" }])).toBe(
      errorMessage(invalid),
    );
  });
});

describe("failureText", () => {
  it("prefers the first field error", () => {
    expect(
      failureText(invalid, [{ field: "until", code: "WINDOW_INVERTED" }]),
    ).toBe("시작이 끝보다 늦습니다.");
  });

  it("uses the server message for unknown codes", () => {
    expect(failureText({ code: "INTERNAL", message: "서버 오류" }, [])).toBe(
      "서버 오류",
    );
  });
});
