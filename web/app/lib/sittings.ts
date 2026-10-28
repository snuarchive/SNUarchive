import type { Schemas } from "~/api/types";

type Term = Schemas["Term"];
type Kind = Schemas["AssessmentKind"];
type SittingLike = Pick<
  Schemas["SittingRef"],
  "id" | "kindId" | "number" | "term"
> & {
  voting: { isOpen: boolean };
};

/**
 * The legacy default exam by calendar date: midterm season 4/15–5/5 and
 * 10/15–11/5, finals 6/10–6/30 and 12/10–12/30, midterm otherwise. The
 * caller passes the date in Asia/Seoul.
 */
export function defaultKindCode(
  month: number,
  day: number,
): "midterm" | "final" {
  const md = month * 100 + day;
  if ((md >= 610 && md <= 630) || (md >= 1210 && md <= 1230)) return "final";
  return "midterm";
}

export function sameTerm(a: Term, b: Term): boolean {
  return a.year === b.year && a.semester === b.semester;
}

/**
 * Which sitting the voting section opens on: the newest one open for voting;
 * otherwise this term's sitting of the date-based kind; otherwise the newest.
 * Sittings arrive newest first.
 */
export function pickDefaultSitting<T extends SittingLike>(
  sittings: T[],
  currentTerm: Term,
  defaultKindId: number | null,
): T | null {
  return (
    sittings.find((s) => s.voting.isOpen) ??
    sittings.find(
      (s) =>
        s.kindId === defaultKindId &&
        s.number === null &&
        sameTerm(s.term, currentTerm),
    ) ??
    sittings[0] ??
    null
  );
}

/** Years to offer in term pickers: the current one and every offering's. */
export function termYears(
  currentTerm: Term,
  offerings: { year: number }[],
): number[] {
  const years = new Set([currentTerm.year, ...offerings.map((o) => o.year)]);
  return [...years].sort((a, b) => b - a);
}

export function kindLabel(
  kind: Pick<Kind, "labelFormat">,
  number: number | null,
): string {
  return number === null
    ? kind.labelFormat
    : kind.labelFormat.replace("{n}", String(number));
}

export type SittingKeyInput = {
  kindId: number;
  number: number | null;
  year: number;
  semester: 1 | 2 | 3 | 4;
};

/**
 * Reads kind, number and term fields from a form. The number only counts for
 * numbered kinds; the server checks its range.
 */
export function readSittingKey(
  form: FormData,
  kinds: Kind[],
): SittingKeyInput | null {
  const kindId = Number(form.get("kindId"));
  const kind = kinds.find((k) => k.id === kindId);
  const year = Number(form.get("year"));
  const semester = Number(form.get("semester"));
  if (!kind || !Number.isInteger(year) || ![1, 2, 3, 4].includes(semester))
    return null;
  const rawNumber = String(form.get("number") ?? "").trim();
  const number = kind.numbered && rawNumber ? Number(rawNumber) : null;
  if (
    kind.numbered &&
    (number === null || !Number.isInteger(number) || number < 1)
  )
    return null;
  return {
    kindId,
    number,
    year,
    semester: semester as SittingKeyInput["semester"],
  };
}
