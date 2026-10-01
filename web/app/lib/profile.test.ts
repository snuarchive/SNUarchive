import { describe, expect, it } from "vitest";

import { parseAdmissionYear, shortYear } from "./profile";

describe("parseAdmissionYear", () => {
  it("treats empty input as no year", () => {
    expect(parseAdmissionYear("  ", 2026)).toEqual({ ok: true, year: null });
  });

  it("expands two digits to 20xx", () => {
    expect(parseAdmissionYear("21", 2026)).toEqual({ ok: true, year: 2021 });
  });

  it("accepts four digits", () => {
    expect(parseAdmissionYear("2019", 2026)).toEqual({ ok: true, year: 2019 });
  });

  it("rejects other lengths and non-digits", () => {
    for (const input of ["1", "123", "20a1", "21학번"]) {
      expect(parseAdmissionYear(input, 2026).ok).toBe(false);
    }
  });

  it("allows next year but not later", () => {
    expect(parseAdmissionYear("2027", 2026)).toEqual({ ok: true, year: 2027 });
    expect(parseAdmissionYear("2028", 2026).ok).toBe(false);
  });

  it("rejects years before 1980", () => {
    expect(parseAdmissionYear("1979", 2026).ok).toBe(false);
  });
});

describe("shortYear", () => {
  it("keeps the last two digits", () => {
    expect(shortYear(2021)).toBe("21");
    expect(shortYear(null)).toBe("");
  });
});
