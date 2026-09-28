import { describe, expect, it } from "vitest";

import { normalizeOrigin } from "./origin";

describe("normalizeOrigin", () => {
  it("writes an origin the way browsers send it", () => {
    expect(normalizeOrigin("https://Archive.example:443/")).toBe(
      "https://archive.example",
    );
    expect(normalizeOrigin("http://localhost:5173")).toBe(
      "http://localhost:5173",
    );
  });

  it("refuses more than an origin", () => {
    expect(() => normalizeOrigin("https://a.example/app")).toThrow();
    expect(() => normalizeOrigin("https://a.example/?x=1")).toThrow();
    expect(() => normalizeOrigin("a.example")).toThrow();
  });
});
