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

  it("matches the backend's examples (internal/config/parse.go)", () => {
    expect(normalizeOrigin("HTTPS://Archive.Example.com:443/")).toBe(
      "https://archive.example.com",
    );
    expect(normalizeOrigin("http://localhost:80")).toBe("http://localhost");
    expect(normalizeOrigin("https://archive.example.com:80")).toBe(
      "https://archive.example.com:80",
    );
  });

  it("refuses more than an http or https origin", () => {
    expect(() => normalizeOrigin("https://a.example/app")).toThrow();
    expect(() => normalizeOrigin("https://a.example/?x=1")).toThrow();
    expect(() => normalizeOrigin("https://user@a.example")).toThrow();
    expect(() => normalizeOrigin("ftp://a.example")).toThrow();
    expect(() => normalizeOrigin("a.example")).toThrow();
  });
});
