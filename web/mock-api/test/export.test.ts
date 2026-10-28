import { describe, expect, it } from "vitest";
import { encodeExport } from "../src/export";
import type { S } from "../src/types";

function csv(displayName: string, ip = "127.0.0.1") {
  const entry: S<"ActivityLogEntry"> = {
    id: 1,
    createdAt: "2026-10-28T00:00:00Z",
    action: "login",
    user: { id: 1, displayName, deleted: false },
    ip,
    metadata: {},
  };
  return new TextDecoder().decode(encodeExport("csv", [entry]));
}

describe("CSV export", () => {
  it.each([
    ["=1+1", "'=1+1"],
    ["+1+1", "'+1+1"],
    ["-1+1", "'-1+1"],
    ["@SUM(1)", "'@SUM(1)"],
    ["\ttext", "'\ttext"],
    ["\rtext", '"\'\rtext"'],
    ["\ntext", '"\'\ntext"'],
    ['=SUM(1,2)&"x"', '"\'=SUM(1,2)&""x"""'],
  ])("prefixes formula-leading text %j before CSV escaping", (value, cell) => {
    expect(csv(value)).toContain(`,${cell},127.0.0.1,{}\r\n`);
  });

  it("protects the client IP column too", () => {
    expect(csv("김*수", "=1+1")).toContain(",김*수,'=1+1,{}\r\n");
  });

  it("keeps ordinary text, numbers and CSV quoting", () => {
    expect(csv('a,"b"')).toBe(
      "id,createdAt,action,userId,userDisplayName,ip,metadata\r\n" +
        '1,2026-10-28T00:00:00Z,login,1,"a,""b""",127.0.0.1,{}\r\n',
    );
  });
});
