import { describe, expect, it } from "vitest";

import { cleanNumberText } from "./forms";

describe("cleanNumberText", () => {
  it("keeps digits and the first decimal point", () => {
    expect(cleanNumberText("1e2")).toBe("12");
    expect(cleanNumberText("-3.5.1")).toBe("3.51");
    expect(cleanNumberText(" 72점 ")).toBe("72");
    expect(cleanNumberText("88.25")).toBe("88.25");
  });
});
