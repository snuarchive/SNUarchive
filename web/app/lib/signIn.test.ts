import { describe, expect, it } from "vitest";

import { signInHref, withAuthOk } from "./signIn";

describe("signInHref", () => {
  it("leaves next off on the home page", () => {
    expect(signInHref("/")).toBe("/api/v1/auth/google");
  });

  it("carries the page and its query as next", () => {
    expect(signInHref("/courses/12?q=미적분")).toBe(
      `/api/v1/auth/google?next=${encodeURIComponent("/courses/12?q=미적분")}`,
    );
  });
});

describe("withAuthOk", () => {
  it("adds auth=ok and keeps the query", () => {
    expect(withAuthOk("/courses/12?q=a")).toBe("/courses/12?q=a&auth=ok");
    expect(withAuthOk("/")).toBe("/?auth=ok");
  });
});
