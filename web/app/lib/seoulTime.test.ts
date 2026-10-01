import { describe, expect, it } from "vitest";

import { fromSeoulInput, toSeoulInput } from "./seoulTime";

describe("fromSeoulInput", () => {
  it("reads the value as Seoul time", () => {
    expect(fromSeoulInput("2026-10-20T18:00")).toBe("2026-10-20T09:00:00.000Z");
  });

  it("crosses midnight correctly", () => {
    expect(fromSeoulInput("2026-01-01T03:30")).toBe("2025-12-31T18:30:00.000Z");
  });

  it("returns null for empty or malformed input", () => {
    expect(fromSeoulInput("")).toBeNull();
    expect(fromSeoulInput("2026-10-20")).toBeNull();
  });
});

describe("toSeoulInput", () => {
  it("renders an instant in Seoul", () => {
    expect(toSeoulInput("2026-10-20T09:00:00Z")).toBe("2026-10-20T18:00");
  });

  it("round-trips", () => {
    expect(toSeoulInput(fromSeoulInput("2026-03-01T00:15"))).toBe(
      "2026-03-01T00:15",
    );
  });

  it("is empty for no value", () => {
    expect(toSeoulInput(null)).toBe("");
  });
});
