import { describe, expect, it } from "vitest";

import { pagePath } from "./url.server";

const req = (url: string) => new Request(`http://localhost${url}`);

describe("pagePath", () => {
  it("maps the root data request back to /", () => {
    expect(pagePath(req("/_.data?auth=ok&_routes=root"))).toBe("/?auth=ok");
  });

  it("maps a route data request back to its page", () => {
    expect(
      pagePath(
        req("/courses/12.data?q=%EB%AF%B8&_routes=root,routes/archive/course"),
      ),
    ).toBe("/courses/12?q=%EB%AF%B8");
  });

  it("leaves document requests alone", () => {
    expect(pagePath(req("/admin/logs/delete?action=login"))).toBe(
      "/admin/logs/delete?action=login",
    );
  });
});
