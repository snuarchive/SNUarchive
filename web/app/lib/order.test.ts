import { describe, expect, it } from "vitest";

import { moveBy, moveTo, parseIds } from "./order";

describe("moveBy", () => {
  it("moves an item up and down", () => {
    expect(moveBy([1, 2, 3], 2, -1)).toEqual([2, 1, 3]);
    expect(moveBy([1, 2, 3], 2, 1)).toEqual([1, 3, 2]);
  });

  it("does nothing at the ends or for a missing item", () => {
    const items = [1, 2, 3];
    expect(moveBy(items, 1, -1)).toBe(items);
    expect(moveBy(items, 3, 1)).toBe(items);
    expect(moveBy(items, 9, 1)).toBe(items);
  });
});

describe("moveTo", () => {
  it("drops an item at a new index", () => {
    expect(moveTo(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveTo(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
  });

  it("clamps the target", () => {
    expect(moveTo(["a", "b", "c"], 0, 99)).toEqual(["b", "c", "a"]);
  });
});

describe("parseIds", () => {
  it("reads a comma list", () => {
    expect(parseIds("3, 1,2")).toEqual([3, 1, 2]);
    expect(parseIds("")).toEqual([]);
  });

  it("refuses anything else", () => {
    expect(parseIds("1,x")).toBeNull();
    expect(parseIds("1,-2")).toBeNull();
    expect(parseIds("1.5")).toBeNull();
  });
});
