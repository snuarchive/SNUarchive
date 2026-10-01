import { describe, expect, it } from "vitest";

import { statGraphModel } from "./statGraph";

const blank = {
  q1: null,
  q2: null,
  q3: null,
  q4: null,
  average: null,
  maxScore: null,
};

describe("statGraphModel", () => {
  it("is empty without figures", () => {
    expect(statGraphModel(blank)).toEqual({ empty: true });
  });

  it("scales to the full mark", () => {
    const model = statGraphModel({
      ...blank,
      q1: 25,
      q2: 50,
      q3: 75,
      average: 40,
      maxScore: 100,
    });
    expect(model).toMatchObject({
      empty: false,
      range: { left: 25, width: 50 },
      scaleLabel: "만점 100",
    });
    if (!model.empty) {
      expect(model.markers.map((m) => [m.key, m.left])).toEqual([
        ["q1", 25],
        ["q2", 50],
        ["q3", 75],
        ["average", 40],
      ]);
    }
  });

  it("scales to the largest figure without a full mark", () => {
    const model = statGraphModel({ ...blank, q2: 30, q4: 60 });
    expect(model).toMatchObject({
      empty: false,
      range: null,
      scaleLabel: "기준 60",
    });
    if (!model.empty)
      expect(model.markers).toEqual([
        { key: "q2", label: "Q2", value: 30, left: 50 },
      ]);
  });

  it("keeps the axis when figures exceed a stale full mark", () => {
    const model = statGraphModel({ ...blank, q3: 120, maxScore: 100 });
    if (!model.empty) expect(model.markers[0].left).toBe(100);
  });
});
