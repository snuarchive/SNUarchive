import { describe, expect, it } from "vitest";

import { filterQuery, isEmptyFilter, readLogFilter } from "./logFilter";
import { actionLabel } from "./activity";

describe("readLogFilter", () => {
  it("reads Seoul datetimes, known actions and a user id", () => {
    const params = new URLSearchParams(
      "from=2026-09-01T00:00&until=2026-09-02T00:00&action=login&action=vote_cast&action=bogus&userId=7",
    );
    expect(readLogFilter(params)).toEqual({
      from: "2026-08-31T15:00:00.000Z",
      until: "2026-09-01T15:00:00.000Z",
      action: ["login", "vote_cast"],
      userId: 7,
    });
  });

  it("drops empty and invalid fields", () => {
    const filter = readLogFilter(
      new URLSearchParams("from=&userId=abc&cursor=x"),
    );
    expect(filter).toEqual({});
    expect(isEmptyFilter(filter)).toBe(true);
  });

  it("drops inherited object properties while keeping valid actions", () => {
    expect(
      readLogFilter(
        new URLSearchParams(
          "action=toString&action=login&action=constructor&action=__proto__",
        ),
      ),
    ).toEqual({ action: ["login"] });
  });
});

describe("actionLabel", () => {
  it.each(["toString", "constructor", "__proto__", "future_action"])(
    "renders unknown action %s as its code",
    (action) => expect(actionLabel(action)).toBe(action),
  );
});

describe("filterQuery", () => {
  it("keeps only filter fields", () => {
    expect(
      filterQuery(
        new URLSearchParams(
          "from=2026-09-01T00:00&cursor=abc&action=login&userId=",
        ),
      ),
    ).toBe("from=2026-09-01T00%3A00&action=login");
  });
});
