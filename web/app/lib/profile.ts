export type AdmissionYearResult =
  { ok: true; year: number | null } | { ok: false; message: string };

/**
 * The legacy rule: two or four digits, two meaning 20xx, within 1980 and next
 * year. The API only takes four digits, so the expansion happens here.
 */
export function parseAdmissionYear(
  input: string,
  currentYear: number,
): AdmissionYearResult {
  const text = input.trim();
  if (!text) return { ok: true, year: null };
  if (!/^\d{2}$|^\d{4}$/.test(text)) {
    return {
      ok: false,
      message: "입학년도는 2자리 또는 4자리 숫자로 입력해주세요.",
    };
  }
  const year = text.length === 2 ? 2000 + Number(text) : Number(text);
  if (year < 1980 || year > currentYear + 1) {
    return { ok: false, message: "입학년도 값이 올바르지 않습니다." };
  }
  return { ok: true, year };
}

/** How the banner pre-fills a suggested year: its last two digits. */
export function shortYear(year: number | null | undefined): string {
  return year ? String(year).slice(2) : "";
}
