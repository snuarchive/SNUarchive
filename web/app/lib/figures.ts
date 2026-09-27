export const FIGURE_NAMES = [
  "q1",
  "q2",
  "q3",
  "q4",
  "average",
  "maxScore",
] as const;
type FigureName = (typeof FIGURE_NAMES)[number];

export type Figures = Partial<Record<FigureName, number>> & { note?: string };

/**
 * Reads score fields for the API: empty fields are omitted (the API treats
 * omitted as null, never zero). Unparseable numbers are reported by name so
 * the form can say which one.
 */
export function readFigures(form: FormData): {
  figures: Figures;
  invalid: FigureName[];
} {
  const figures: Figures = {};
  const invalid: FigureName[] = [];
  for (const name of FIGURE_NAMES) {
    const text = String(form.get(name) ?? "").trim();
    if (!text) continue;
    const value = Number(text);
    if (Number.isFinite(value) && value >= 0) figures[name] = value;
    else invalid.push(name);
  }
  const note = String(form.get("note") ?? "").trim();
  if (note) figures.note = note;
  return { figures, invalid };
}

/** Nickname as the API takes it: trimmed, empty meaning anonymous. */
export function readNickname(form: FormData): string | null {
  const nickname = String(form.get("nickname") ?? "").trim();
  return nickname ? [...nickname].slice(0, 10).join("") : null;
}

/** The submitted text fields, to refill a refused form. */
export function formValues(form: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of form)
    if (typeof value === "string") values[key] = value;
  return values;
}
