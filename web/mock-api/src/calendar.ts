import type { Term } from "./types";

export const TIMEZONE = "Asia/Seoul";
const SEOUL_OFFSET_MS = 9 * 3600 * 1000; // Korea has no DST.
const DAY_MS = 24 * 3600 * 1000;

/** Calendar date in Seoul for an instant. */
export function seoulDate(ms: number): {
  year: number;
  month: number;
  day: number;
} {
  const d = new Date(ms + SEOUL_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

/** The instant of Seoul midnight on the given date. */
export function seoulMidnight(
  year: number,
  month: number,
  day: number,
): number {
  return Date.UTC(year, month - 1, day) - SEOUL_OFFSET_MS;
}

/**
 * The contract leaves term boundaries to the server. The mock uses whole
 * months: Mar–Jun spring (1), Jul–Aug summer (2), Sep–Dec fall (3), and
 * Jan–Feb the previous year's winter (4).
 */
export function termAt(ms: number): Term {
  const { year, month } = seoulDate(ms);
  if (month <= 2) return { year: year - 1, semester: 4 };
  if (month <= 6) return { year, semester: 1 };
  if (month <= 8) return { year, semester: 2 };
  return { year, semester: 3 };
}

export function termStart(term: Term): number {
  switch (term.semester) {
    case 1:
      return seoulMidnight(term.year, 3, 1);
    case 2:
      return seoulMidnight(term.year, 7, 1);
    case 3:
      return seoulMidnight(term.year, 9, 1);
    case 4:
      return seoulMidnight(term.year + 1, 1, 1);
  }
}

export function compareTerms(a: Term, b: Term): number {
  return a.year - b.year || a.semester - b.semester;
}

export function previousTerm(t: Term): Term {
  return t.semester === 1
    ? { year: t.year - 1, semester: 4 }
    : { year: t.year, semester: (t.semester - 1) as Term["semester"] };
}

/** Whole Seoul days between two instants (b − a). */
export function seoulDayDiff(a: number, b: number): number {
  const da = seoulDate(a);
  const db = seoulDate(b);
  return Math.round(
    (seoulMidnight(db.year, db.month, db.day) -
      seoulMidnight(da.year, da.month, da.day)) /
      DAY_MS,
  );
}

export function calendarBody(now: number): {
  currentTerm: Term;
  timezone: string;
} {
  return { currentTerm: termAt(now), timezone: TIMEZONE };
}

export { DAY_MS };
