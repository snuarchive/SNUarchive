import { describe, expect, it } from "vitest";

import { readFigures, readNickname } from "./figures";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("readFigures", () => {
  it("omits empty fields rather than sending zero", () => {
    expect(
      readFigures(form({ q1: "", q2: "55.5", maxScore: "100", note: " " })),
    ).toEqual({
      figures: { q2: 55.5, maxScore: 100 },
      invalid: [],
    });
  });

  it("keeps a note", () => {
    expect(readFigures(form({ note: " 쉬웠음 " })).figures).toEqual({
      note: "쉬웠음",
    });
  });

  it("reports unparseable and negative numbers", () => {
    expect(readFigures(form({ q1: "abc", q3: "-1" })).invalid).toEqual([
      "q1",
      "q3",
    ]);
  });
});

describe("readNickname", () => {
  it("trims and treats empty as anonymous", () => {
    expect(readNickname(form({ nickname: "  " }))).toBeNull();
    expect(readNickname(form({ nickname: " 익명의학생 " }))).toBe("익명의학생");
  });

  it("cuts at ten code points", () => {
    expect(readNickname(form({ nickname: "가나다라마바사아자차카" }))).toBe(
      "가나다라마바사아자차",
    );
  });
});
