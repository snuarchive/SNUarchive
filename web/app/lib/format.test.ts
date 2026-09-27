import { describe, expect, it } from "vitest";

import {
  codePointLength,
  departmentsText,
  displayNumber,
  formatDate,
  percentOf,
  ratingLabel,
  termLabel,
} from "./format";

describe("departmentsText", () => {
  it("lists up to two departments", () => {
    expect(departmentsText(["수학과"], 1)).toBe("수학과");
    expect(departmentsText(["물리학과", "수학과"], 2)).toBe("물리학과, 수학과");
  });

  it("adds the rest as 외 N", () => {
    expect(departmentsText(["물리학과", "수학과"], 5)).toBe(
      "물리학과, 수학과 외 3",
    );
  });

  it("falls back to 미분류", () => {
    expect(departmentsText([], 0)).toBe("미분류");
  });
});

describe("displayNumber", () => {
  it("keeps integers and rounds others to one decimal", () => {
    expect(displayNumber(42)).toBe("42");
    expect(displayNumber(42.25)).toBe("42.3");
    expect(displayNumber("7.04")).toBe("7");
  });

  it("shows missing values as a dash", () => {
    expect(displayNumber(null)).toBe("-");
    expect(displayNumber(undefined)).toBe("-");
    expect(displayNumber("")).toBe("-");
  });
});

describe("percentOf", () => {
  it("clamps to 0..100", () => {
    expect(percentOf(50, 200)).toBe(25);
    expect(percentOf(300, 200)).toBe(100);
    expect(percentOf(-1, 200)).toBe(0);
  });

  it("returns null without a value or a scale", () => {
    expect(percentOf(null, 100)).toBeNull();
    expect(percentOf(10, 0)).toBeNull();
  });
});

describe("formatDate", () => {
  it("uses Asia/Seoul regardless of the host zone", () => {
    // 2026-03-01 23:30 UTC is already 3월 2일 in Seoul.
    expect(formatDate("2026-03-01T23:30:00Z")).toBe("26. 03. 02.");
  });

  it("shows a dash for missing dates", () => {
    expect(formatDate(null)).toBe("-");
  });
});

describe("ratingLabel", () => {
  it("maps 1..5 to the legacy labels", () => {
    expect(ratingLabel(1)).toBe("매우 쉬움");
    expect(ratingLabel(5)).toBe("매우 어려움");
    expect(ratingLabel(null)).toBe("-");
  });
});

describe("termLabel", () => {
  const semesters = [
    { value: 1, label: "1학기" },
    { value: 2, label: "여름학기" },
    { value: 3, label: "2학기" },
    { value: 4, label: "겨울학기" },
  ];

  it("uses the configured label, so 2 is summer and 3 is fall", () => {
    expect(termLabel({ year: 2025, semester: 2 }, semesters)).toBe(
      "2025 여름학기",
    );
    expect(termLabel({ year: 2025, semester: 3 }, semesters)).toBe(
      "2025 2학기",
    );
  });
});

describe("codePointLength", () => {
  it("counts emoji as one character", () => {
    expect(codePointLength("좋아요👍")).toBe(4);
  });
});
