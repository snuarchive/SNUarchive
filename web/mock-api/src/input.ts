// Request parsing and the field rules the contract names.
//
// Shape errors (unparseable JSON, a wrong JSON type, an unknown property where
// the schema forbids them) are 400 MALFORMED_REQUEST. Rule errors a user can
// make through a form (missing, too long, out of range, ordering) are 422
// VALIDATION_FAILED with FieldErrors.
import type { Context } from "hono";
import { FieldErrors, malformed } from "./errors";
import type { SittingKey } from "./domain";
import { kindById, LIMITS } from "./refdata";
import type { Figures } from "./state";

export type Body = Record<string, unknown>;

export async function readJson(
  c: Context,
  allowed?: readonly string[],
): Promise<Body> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw malformed("JSON 본문을 해석할 수 없습니다.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw malformed("본문은 JSON 객체여야 합니다.");
  if (allowed) {
    const extra = Object.keys(body).filter((k) => !allowed.includes(k));
    if (extra.length) throw malformed(`알 수 없는 필드: ${extra.join(", ")}`);
  }
  return body as Body;
}

/** Code-point length, as the contract counts lengths. */
export function cpLength(s: string): number {
  return [...s].length;
}

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/gu, " ").trim();
}

export function str(body: Body, key: string): string | undefined;
export function str(
  body: Body,
  key: string,
  opts: { nullable: true },
): string | null | undefined;
export function str(
  body: Body,
  key: string,
  opts: { nullable?: boolean } = {},
): string | null | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (v === null) {
    if (opts.nullable) return null;
    throw malformed(`${key}: null은 허용되지 않습니다.`);
  }
  if (typeof v !== "string") throw malformed(`${key}: 문자열이어야 합니다.`);
  return v;
}

export function int(body: Body, key: string): number | undefined;
export function int(
  body: Body,
  key: string,
  opts: { nullable: true },
): number | null | undefined;
export function int(
  body: Body,
  key: string,
  opts: { nullable?: boolean } = {},
): number | null | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (v === null) {
    if (opts.nullable) return null;
    throw malformed(`${key}: null은 허용되지 않습니다.`);
  }
  if (typeof v !== "number" || !Number.isInteger(v))
    throw malformed(`${key}: 정수여야 합니다.`);
  return v;
}

export function num(body: Body, key: string): number | null | undefined {
  const v = body[key];
  if (v === undefined || v === null) return v as null | undefined;
  if (typeof v !== "number" || !Number.isFinite(v))
    throw malformed(`${key}: 숫자여야 합니다.`);
  return v;
}

export function bool(body: Body, key: string): boolean | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (typeof v !== "boolean")
    throw malformed(`${key}: true 또는 false여야 합니다.`);
  return v;
}

const DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;

export function parseDateTime(v: string, key: string): number {
  const ms = Date.parse(v);
  if (!DATE_TIME.test(v) || Number.isNaN(ms))
    throw malformed(`${key}: RFC 3339 날짜-시간이어야 합니다.`);
  return ms;
}

export function dateTime(
  body: Body,
  key: string,
  opts: { nullable?: boolean } = {},
): number | null | undefined {
  const v = opts.nullable ? str(body, key, { nullable: true }) : str(body, key);
  if (v === undefined || v === null) return v;
  return parseDateTime(v, key);
}

// ------------------------------------------------------------- sitting key

export interface RawSittingKey {
  kindId?: number | null;
  number?: number | null;
  year?: number | null;
  semester?: number | null;
}

/** The body fields readSittingKey reads. */
export const SITTING_KEY_FIELDS = ["kindId", "number", "year", "semester"];

export function readSittingKey(body: Body): RawSittingKey {
  return {
    kindId: int(body, "kindId"),
    number: int(body, "number", { nullable: true }),
    year: int(body, "year"),
    semester: int(body, "semester"),
  };
}

/** Checks a complete key; missing parts are REQUIRED. */
export function checkSittingKey(
  raw: RawSittingKey,
  fe: FieldErrors,
): SittingKey | null {
  if (raw.kindId == null) fe.add("kindId", "REQUIRED");
  if (raw.year == null) fe.add("year", "REQUIRED");
  if (raw.semester == null) fe.add("semester", "REQUIRED");
  const kind = raw.kindId == null ? undefined : kindById(raw.kindId);
  if (raw.kindId != null && !kind) fe.add("kindId", "UNKNOWN_ASSESSMENT_KIND");
  const number = raw.number ?? null;
  if (kind) {
    if (
      kind.numbered &&
      (number === null || number < 1 || number > (kind.maxNumber ?? Infinity))
    ) {
      fe.add("number", "INVALID_ASSESSMENT_NUMBER");
    }
    if (!kind.numbered && number !== null)
      fe.add("number", "INVALID_ASSESSMENT_NUMBER");
  }
  if (
    raw.year != null &&
    (raw.year < LIMITS.yearMin || raw.year > LIMITS.yearMax)
  )
    fe.add("year", "INVALID_TERM");
  if (raw.semester != null && ![1, 2, 3, 4].includes(raw.semester))
    fe.add("semester", "INVALID_TERM");
  if (fe.list.length) return null;
  return {
    kindId: raw.kindId!,
    number,
    year: raw.year!,
    semester: raw.semester as SittingKey["semester"],
  };
}

// ----------------------------------------------------------------- figures

export const FIGURE_KEYS = [
  "q1",
  "q2",
  "q3",
  "q4",
  "average",
  "maxScore",
] as const;
export type FigureKey = (typeof FIGURE_KEYS)[number];

/** The body fields readFigures reads. */
export const FIGURE_FIELDS = [...FIGURE_KEYS, "note"];

/** Present keys only, so PATCH can tell "absent" from "null". */
export function readFigures(body: Body): Partial<Figures> {
  const out: Partial<Figures> = {};
  for (const k of FIGURE_KEYS) {
    const v = num(body, k);
    if (v !== undefined) out[k] = v;
  }
  const note = str(body, "note", { nullable: true });
  if (note !== undefined) out.note = note === null ? null : note.trim() || null;
  return out;
}

export function completeFigures(p: Partial<Figures>): Figures {
  return {
    q1: p.q1 ?? null,
    q2: p.q2 ?? null,
    q3: p.q3 ?? null,
    q4: p.q4 ?? null,
    average: p.average ?? null,
    maxScore: p.maxScore ?? null,
    note: p.note ?? null,
  };
}

/**
 * Mirrors the stat_reports CHECK constraints. `VALUE_OUT_OF_RANGE` and
 * `QUARTILES_OUT_OF_ORDER` each come from one constraint over several
 * columns, so, as the contract says, they are reported once on the field `""`.
 * `VALUE_ABOVE_MAX_SCORE` stays per field.
 */
export function checkFigures(f: Figures, fe: FieldErrors): void {
  for (const k of FIGURE_KEYS) {
    const v = f[k];
    if (v === null) continue;
    if (v < 0 || v > LIMITS.scoreMax || Math.round(v * 100) / 100 !== v)
      fe.add("", "VALUE_OUT_OF_RANGE");
  }
  if (f.note !== null && cpLength(f.note) > LIMITS.statisticNoteMaxLength)
    fe.add("note", "TOO_LONG");

  let prev: number | null = null;
  for (const k of ["q1", "q2", "q3", "q4"] as const) {
    const v = f[k];
    if (v === null) continue;
    if (prev !== null && v < prev) fe.add("", "QUARTILES_OUT_OF_ORDER");
    prev = Math.max(prev ?? v, v);
  }
  if (f.maxScore !== null) {
    for (const k of ["q1", "q2", "q3", "q4", "average"] as const) {
      const v = f[k];
      if (v !== null && v > f.maxScore) fe.add(k, "VALUE_ABOVE_MAX_SCORE");
    }
  }
  if (FIGURE_KEYS.every((k) => f[k] === null) && !f.note)
    fe.add("", "NOTHING_SUBMITTED");
}

// ---------------------------------------------------------------- nickname

export function checkNickname(
  raw: string | null | undefined,
  fe: FieldErrors,
  field = "nickname",
): string {
  const v = (raw ?? "").trim();
  if (cpLength(v) > LIMITS.nicknameMaxLength) fe.add(field, "TOO_LONG");
  return v || LIMITS.anonymous;
}

export function checkMaxLength(
  v: string | null | undefined,
  max: number,
  field: string,
  fe: FieldErrors,
): void {
  if (v && cpLength(v) > max) fe.add(field, "TOO_LONG");
}

// -------------------------------------------------------------- pagination

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export function queryInt(c: Context, key: string): number | undefined {
  const v = c.req.query(key);
  if (v === undefined) return undefined;
  if (!/^-?\d+$/.test(v)) throw malformed(`${key}: 정수여야 합니다.`);
  return Number(v);
}

export function readLimit(c: Context): number {
  const limit = queryInt(c, "limit") ?? 20;
  if (limit < 1 || limit > 50) throw malformed("limit은 1 이상 50 이하입니다.");
  return limit;
}

// Opaque cursors: base64url of the offset. Real keyset cursors are not needed
// for an in-memory list; clients must treat them as opaque either way.
export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString("base64url");
}

export function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined || cursor === "") return 0;
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      o?: unknown;
    };
    if (typeof v.o === "number" && Number.isInteger(v.o) && v.o >= 0)
      return v.o;
  } catch {
    // fall through
  }
  throw malformed("cursor가 올바르지 않습니다.");
}

export function paginate<T, R>(
  c: Context,
  rows: T[],
  map: (row: T) => R,
): Page<R> {
  const limit = readLimit(c);
  const offset = decodeCursor(c.req.query("cursor"));
  const slice = rows.slice(offset, offset + limit);
  const next =
    offset + limit < rows.length ? encodeCursor(offset + limit) : null;
  return { items: slice.map(map), nextCursor: next };
}

export function optionalIdQuery(c: Context, key: string): number | undefined {
  const v = queryInt(c, key);
  if (v !== undefined && v < 1) throw malformed(`${key}: 1 이상이어야 합니다.`);
  return v;
}

export function pathId(c: Context, key: string): number {
  const v = c.req.param(key) ?? "";
  // A non-numeric id cannot name anything: treat it as an unknown id.
  return /^[1-9]\d{0,15}$/.test(v) ? Number(v) : -1;
}
