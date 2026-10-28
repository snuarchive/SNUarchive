import { describe, expect, it } from "vitest";

import { back, safePath } from "./redirect.server";

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

  it.each([
    "/..//outside.example",
    "/.//outside.example",
    "/%2e//outside.example",
    "/%2E%2e//outside.example",
    "/.%2e//outside.example?next=/me#profile",
    "/%2e.//outside.example",
    "/..//same-origin.invalid/me",
  ])("refuses a path that normalizes to an authority: %s", (value) => {
    expect(safePath(value, "/home?tab=1#top")).toBe("/home?tab=1#top");
  });

  it("preserves the query and fragment when normalizing an internal path", () => {
    expect(safePath("/courses/../me?q=%EB%AF%B8&tab=1#profile", "/")).toBe(
      "/me?q=%EB%AF%B8&tab=1#profile",
    );
  });
});

describe("back", () => {
  it("uses the fallback Location when normalization creates an authority", () => {
    const form = new FormData();
    form.set("redirectTo", "/..//outside.example");
    const response = back(form, "/me#favorites");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/me#favorites");
  });
});
