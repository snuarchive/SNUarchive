import { describe, expect, it } from "vitest";

import {
  defaultKindCode,
  kindLabel,
  pickDefaultSitting,
  readSittingKey,
  termYears,
} from "./sittings";

describe("defaultKindCode", () => {
  it("picks finals in the June and December windows", () => {
    expect(defaultKindCode(6, 10)).toBe("final");
    expect(defaultKindCode(6, 30)).toBe("final");
    expect(defaultKindCode(12, 10)).toBe("final");
    expect(defaultKindCode(12, 30)).toBe("final");
  });

  it("picks midterm in the midterm windows and at any other time", () => {
    expect(defaultKindCode(4, 15)).toBe("midterm");
    expect(defaultKindCode(11, 5)).toBe("midterm");
    expect(defaultKindCode(7, 1)).toBe("midterm");
    expect(defaultKindCode(12, 31)).toBe("midterm");
  });
});

const term = (year: number, semester: number) => ({
  year,
  semester: semester as 1 | 2 | 3 | 4,
});
const sitting = (
  id: number,
  kindId: number,
  t: ReturnType<typeof term>,
  isOpen = false,
) => ({
  id,
  kindId,
  number: null,
  term: t,
  voting: { isOpen },
});

describe("pickDefaultSitting", () => {
  const MIDTERM = 1;
  const FINAL = 2;

  it("prefers the newest open sitting", () => {
    const sittings = [
      sitting(1, FINAL, term(2026, 1)),
      sitting(2, MIDTERM, term(2026, 1), true),
      sitting(3, MIDTERM, term(2025, 3), true),
    ];
    expect(pickDefaultSitting(sittings, term(2026, 1), FINAL)?.id).toBe(2);
  });

  it("falls back to this term's date-based kind", () => {
    const sittings = [
      sitting(1, FINAL, term(2026, 1)),
      sitting(2, MIDTERM, term(2026, 1)),
    ];
    expect(pickDefaultSitting(sittings, term(2026, 1), MIDTERM)?.id).toBe(2);
  });

  it("falls back to the newest sitting", () => {
    const sittings = [
      sitting(1, FINAL, term(2025, 3)),
      sitting(2, MIDTERM, term(2025, 1)),
    ];
    expect(pickDefaultSitting(sittings, term(2026, 1), MIDTERM)?.id).toBe(1);
  });

  it("returns null without sittings", () => {
    expect(pickDefaultSitting([], term(2026, 1), MIDTERM)).toBeNull();
  });
});

describe("termYears", () => {
  it("merges the current year with offering years, newest first", () => {
    expect(
      termYears(term(2026, 1), [
        { year: 2024 },
        { year: 2025 },
        { year: 2024 },
      ]),
    ).toEqual([2026, 2025, 2024]);
  });
});

describe("kindLabel", () => {
  it("fills the number into the format", () => {
    expect(kindLabel({ labelFormat: "퀴즈 {n}" }, 3)).toBe("퀴즈 3");
    expect(kindLabel({ labelFormat: "중간" }, null)).toBe("중간");
  });
});

describe("readSittingKey", () => {
  const kinds = [
    {
      id: 1,
      code: "midterm",
      label: "중간",
      numbered: false,
      maxNumber: null,
      labelFormat: "중간",
      sortOrder: 1,
    },
    {
      id: 3,
      code: "quiz",
      label: "퀴즈",
      numbered: true,
      maxNumber: 20,
      labelFormat: "퀴즈 {n}",
      sortOrder: 3,
    },
  ];
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [k, v] of Object.entries(fields)) data.set(k, v);
    return data;
  };

  it("ignores the number for unnumbered kinds", () => {
    expect(
      readSittingKey(
        form({ kindId: "1", number: "4", year: "2026", semester: "1" }),
        kinds,
      ),
    ).toEqual({
      kindId: 1,
      number: null,
      year: 2026,
      semester: 1,
    });
  });

  it("requires a positive number for numbered kinds", () => {
    expect(
      readSittingKey(
        form({ kindId: "3", number: "", year: "2026", semester: "1" }),
        kinds,
      ),
    ).toBeNull();
    expect(
      readSittingKey(
        form({ kindId: "3", number: "2", year: "2026", semester: "3" }),
        kinds,
      ),
    ).toEqual({
      kindId: 3,
      number: 2,
      year: 2026,
      semester: 3,
    });
  });

  it("rejects unknown kinds and semesters", () => {
    expect(
      readSittingKey(form({ kindId: "9", year: "2026", semester: "1" }), kinds),
    ).toBeNull();
    expect(
      readSittingKey(form({ kindId: "1", year: "2026", semester: "5" }), kinds),
    ).toBeNull();
  });
});
