// <input type="datetime-local"> has no zone. Admins mean Seoul time, so values
// are read and written as Asia/Seoul (UTC+9, no daylight saving).

const SEOUL_OFFSET = "+09:00";

/** "2026-10-20T18:00" (Seoul) → ISO instant, or null for an empty input. */
export function fromSeoulInput(value: string): string | null {
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) return null;
  const date = new Date(`${text}:00${SEOUL_OFFSET}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** ISO instant → "2026-10-20T18:00" in Seoul, for an input's value. */
export function toSeoulInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const shifted = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 16);
}
