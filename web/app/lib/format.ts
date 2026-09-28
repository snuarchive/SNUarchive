// Display helpers carried over from the legacy public/app.js. Dates are shown
// in Asia/Seoul so server and browser render the same text.

const dateFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "2-digit",
  month: "2-digit",
  day: "2-digit",
});

const dateTimeFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "2-digit",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatDate(value: string | null | undefined): string {
  return value ? dateFormat.format(new Date(value)) : "-";
}

export function formatDateTime(value: string | null | undefined): string {
  return value ? dateTimeFormat.format(new Date(value)) : "-";
}

/** "학과1, 학과2 외 N": the API sends the first two names and the total. */
export function departmentsText(
  departments: string[],
  departmentCount: number,
): string {
  if (!departments.length) return "미분류";
  const extra = departmentCount - departments.length;
  const shown = departments.slice(0, 2).join(", ");
  return extra > 0 ? `${shown} 외 ${extra}` : shown;
}

export function statNumber(
  value: number | string | null | undefined,
): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Integers as is, other numbers to one decimal place, missing as "-". */
export function displayNumber(
  value: number | string | null | undefined,
): string {
  const number = statNumber(value);
  if (number === null) return "-";
  return Number.isInteger(number)
    ? String(number)
    : String(Math.round(number * 10) / 10);
}

export function percentOf(
  value: number | null | undefined,
  max: number,
): number | null {
  const number = statNumber(value);
  if (number === null || !max) return null;
  return Math.max(0, Math.min(100, (number / max) * 100));
}

export const RATING_LABELS = [
  "매우 쉬움",
  "쉬움",
  "보통",
  "어려움",
  "매우 어려움",
] as const;

export function ratingLabel(value: number | null | undefined): string {
  return value && value >= 1 && value <= 5 ? RATING_LABELS[value - 1] : "-";
}

type SemesterLabel = { value: number; label: string };

/** "2026 1학기", with labels from /config. */
export function termLabel(
  term: { year: number; semester: number },
  semesters: SemesterLabel[],
): string {
  const label =
    semesters.find((s) => s.value === term.semester)?.label ??
    `${term.semester}학기`;
  return `${term.year} ${label}`;
}

/** Counts code points, as the API does for length limits. */
export function codePointLength(text: string): number {
  return [...text].length;
}

/**
 * A comment as the API stores it: trimmed, with runs of whitespace collapsed
 * to one space. Its length limit counts this value.
 */
export function cleanComment(text: string): string {
  return text.trim().replace(/\s+/gu, " ");
}
