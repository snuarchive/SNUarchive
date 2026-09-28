// Logic that does not need the contract file.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { safeNext, withAuthOk } from "../src/auth";
import { termAt } from "../src/calendar";
import { maskName } from "../src/domain";
import type { UserRow } from "../src/state";
import {
  identityKey,
  loadCatalog,
  normalize,
  searchCatalog,
} from "../src/catalog";
import { defaultOptions } from "../src/config";
import { FieldErrors } from "../src/errors";
import { sniff, barChartPng, textPdf } from "../src/files";
import { checkFigures, completeFigures } from "../src/input";

function fixtureCatalog() {
  const dir = mkdtempSync(join(tmpdir(), "snu-mock-catalog-"));
  const row = (
    title: string,
    instructor: string,
    department: string,
    n: string,
    year: number,
    semester: number,
  ) => ({
    course_title: title,
    instructor,
    class_time_json: [],
    course_number: n,
    lecture_number: "001",
    department,
    year,
    semester,
  });
  writeFileSync(
    join(dir, "2025-3.json"),
    JSON.stringify([
      row("미적분학 1", "김교수", "수리과학부", "M1", 2025, 3),
      row("미적분학  1", "김교수", "물리·천문학부", "M1B", 2025, 3),
      row("논리와 비판적 사고", "", "철학과", "P1", 2025, 3),
      row("논리와 비판적 사고", "", "국어국문학과", "P2", 2025, 3),
      row("응용 미적분", "박교수", "경제학부", "E1", 2025, 3),
    ]),
  );
  writeFileSync(
    join(dir, "2026-1.json"),
    JSON.stringify([
      row("미적분학 1", "김교수", "수리과학부", "M1", 2026, 1),
      row("선형대수학", "김교수", "수리과학부", "L1", 2026, 1),
    ]),
  );
  return loadCatalog(dir);
}

describe("catalog", () => {
  const catalog = fixtureCatalog();
  const byTitle = (t: string) => catalog.courses.filter((c) => c.title === t);

  it("normalizes by removing whitespace and lower-casing", () => {
    expect(normalize(" Calculus  1\t")).toBe("calculus1");
    expect(identityKey("미적분학 1", "김교수", "x")).toBe(
      identityKey("미적분학1", "김교수", "y"),
    );
  });

  it("merges a course across departments and terms", () => {
    const calc = byTitle("미적분학 1");
    expect(calc).toHaveLength(1);
    expect(calc[0].departments).toEqual(["물리·천문학부", "수리과학부"]);
    expect(calc[0].offerings.map((o) => `${o.year}-${o.semester}`)).toEqual([
      "2026-1",
      "2025-3",
      "2025-3",
    ]);
    expect(calc[0].latestTerm).toEqual({ year: 2026, semester: 1 });
  });

  it("keys a course without an instructor on its department and shows '미정'", () => {
    const logic = catalog.courses.filter(
      (c) => c.title === "논리와 비판적 사고",
    );
    expect(logic).toHaveLength(2);
    expect(logic.every((c) => c.instructor === "미정")).toBe(true);
  });

  it("assigns ids in identity-key order", () => {
    const keys = catalog.courses.map((c) => c.identityKey);
    expect(keys).toEqual([...keys].sort());
    expect(catalog.courses.map((c) => c.id)).toEqual(
      catalog.courses.map((_, i) => i + 1),
    );
  });

  it("searches with AND over tokens and ranks title prefixes first", () => {
    const titles = (q: string) => searchCatalog(catalog, q).map((c) => c.title);
    expect(titles("미적분")).toEqual(["미적분학 1", "응용 미적분"]);
    expect(titles("김교수 수리")).toEqual(["미적분학 1", "선형대수학"]);
    expect(titles("미적분 경제")).toEqual(["응용 미적분"]);
    expect(titles("철학과")).toEqual(["논리와 비판적 사고"]);
    // Tokens never match across the title/instructor boundary.
    expect(titles("1김")).toEqual([]);
    // Nor across two department names (물리·천문학부 | 수리과학부).
    expect(titles("학부수리")).toEqual([]);
    expect(titles("천문 수리")).toEqual(["미적분학 1"]);
  });
});

describe("bylines", () => {
  const user = (displayName: string | null, email = "x@snu.ac.kr") =>
    ({ displayName, email, deletedAt: null }) as UserRow;
  it("keep the first and last character, one * per character between", () => {
    expect(maskName(user("김철수"))).toBe("김*수");
    expect(maskName(user("남궁민수"))).toBe("남**수");
    expect(maskName(user("김수"))).toBe("김*");
    expect(maskName(user("김"))).toBe("김");
    expect(maskName({ ...user("김철수"), deletedAt: 1 })).toBeNull();
  });
});

describe("sign-in next", () => {
  const app = "http://localhost:5173";
  it("accepts same-origin paths only", () => {
    for (const ok of ["/", "/courses/12", "/a?b=1#c", "/%2F%2Fx"])
      expect(safeNext(ok, app)).toBe(ok);
    for (const bad of [
      undefined,
      "",
      "courses",
      "//evil.example",
      "/\\evil.example",
      "/a\\b",
      "/a b",
      "/a\nb",
      "/a\u0000b",
      "/a\u007fb",
      "http://localhost:5173/x",
    ])
      expect(safeNext(bad, app)).toBeNull();
  });
  it("adds auth=ok as a query parameter, keeping query and fragment", () => {
    expect(withAuthOk("/")).toBe("/?auth=ok");
    expect(withAuthOk("/courses/12")).toBe("/courses/12?auth=ok");
    expect(withAuthOk("/c?tab=1")).toBe("/c?tab=1&auth=ok");
    expect(withAuthOk("/c?tab=1#x")).toBe("/c?tab=1&auth=ok#x");
    expect(withAuthOk("/c#x?y")).toBe("/c?auth=ok#x?y");
    expect(withAuthOk("/c?")).toBe("/c?auth=ok");
  });
});

describe("calendar", () => {
  const at = (iso: string) => termAt(Date.parse(iso));
  it("maps Seoul dates to terms", () => {
    expect(at("2026-09-27T12:00:00+09:00")).toEqual({
      year: 2026,
      semester: 3,
    });
    expect(at("2026-03-01T00:00:00+09:00")).toEqual({
      year: 2026,
      semester: 1,
    });
    expect(at("2026-02-28T23:59:00+09:00")).toEqual({
      year: 2025,
      semester: 4,
    });
    expect(at("2026-07-15T00:00:00+09:00")).toEqual({
      year: 2026,
      semester: 2,
    });
    // 23:30 UTC on Aug 31 is already Sep 1 in Seoul.
    expect(at("2026-08-31T23:30:00Z")).toEqual({ year: 2026, semester: 3 });
    // Every month boundary of the contract's rule.
    const cases: [string, number, number][] = [
      ["2026-01-01T00:00:00+09:00", 2025, 4],
      ["2026-06-30T23:59:00+09:00", 2026, 1],
      ["2026-07-01T00:00:00+09:00", 2026, 2],
      ["2026-08-31T23:59:00+09:00", 2026, 2],
      ["2026-09-01T00:00:00+09:00", 2026, 3],
      ["2026-12-31T23:59:00+09:00", 2026, 3],
    ];
    for (const [when, year, semester] of cases)
      expect(at(when)).toEqual({ year, semester });
  });
});

describe("statistic rules", () => {
  const check = (f: Partial<Parameters<typeof completeFigures>[0]>) => {
    const fe = new FieldErrors();
    checkFigures(completeFigures(f), fe);
    return fe.list;
  };
  it("accepts partial figures and treats omitted as null", () => {
    expect(check({ q2: 50 })).toEqual([]);
    expect(check({ q1: 10, q3: 30, maxScore: 30 })).toEqual([]);
  });
  it("rejects disorder, values over the maximum and empty submissions", () => {
    // Multi-field and whole-body errors use the field "".
    expect(check({ q1: 30, q2: 20, q3: 10 })).toEqual([
      { field: "", code: "QUARTILES_OUT_OF_ORDER" },
    ]);
    expect(check({ average: 12, q4: 11, maxScore: 10 })).toEqual([
      { field: "q4", code: "VALUE_ABOVE_MAX_SCORE" },
      { field: "average", code: "VALUE_ABOVE_MAX_SCORE" },
    ]);
    expect(check({})).toEqual([{ field: "", code: "NOTHING_SUBMITTED" }]);
    expect(check({ q1: 0.125, average: -1 })).toEqual([
      { field: "", code: "VALUE_OUT_OF_RANGE" },
    ]);
  });
});

describe("files", () => {
  it("sniffs by content, not by name", () => {
    expect(sniff(barChartPng([1, 2]))).toBe("image/png");
    expect(sniff(textPdf(["x"]))).toBe("application/pdf");
    expect(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniff(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(
      sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toBeNull();
  });
});

describe("config", () => {
  it("defaults match the documented environment", () => {
    const o = defaultOptions();
    expect(o).toMatchObject({
      port: 8787,
      appOrigin: "http://localhost:5173",
      adminEmails: ["admin@snu.ac.kr"],
    });
  });
});

describe("unsupported methods", () => {
  it("answer 405 with Allow on a known path", async () => {
    const { createApp } = await import("../src/app");
    const { app } = createApp();
    const res = await app.request("/api/v1/me", { method: "PUT" });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("DELETE, GET, HEAD, PATCH");
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("METHOD_NOT_ALLOWED");
  });

  it("match path parameters", async () => {
    const { createApp } = await import("../src/app");
    const { app } = createApp();
    const res = await app.request("/api/v1/courses/12/favorite", {
      method: "POST",
    });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("DELETE, PUT");
  });

  it("leave unknown paths at 404", async () => {
    const { createApp } = await import("../src/app");
    const { app } = createApp();
    const res = await app.request("/api/v1/nope", { method: "GET" });
    expect(res.status).toBe(404);
  });
});
