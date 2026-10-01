import { describe, expect, it } from "vitest";

import { safePath } from "./redirect.server";

describe("safePath", () => {
  it("keeps same-site paths with their query", () => {
    expect(safePath("/courses/3?q=%EB%AF%B8", "/")).toBe(
      "/courses/3?q=%EB%AF%B8",
    );
  });

  it("refuses other sites in every spelling", () => {
    for (const value of [
      "//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "https://evil.example",
      "/\tevil",
      "javascript:alert(1)",
      "",
    ]) {
      expect(safePath(value, "/home"), value).toBe("/home");
    }
  });

  it("refuses files", () => {
    expect(safePath(new File([], "x"), "/home")).toBe("/home");
  });
});
