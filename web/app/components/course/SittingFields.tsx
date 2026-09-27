import { useState } from "react";

import type { Schemas } from "~/api/types";
import s from "./SittingFields.module.css";

export type SittingDefaults = {
  kindId: number | null;
  number: number | null;
  year: number;
  semester: number;
};

type Props = {
  kinds: Schemas["AssessmentKind"][];
  semesters: { value: number; label: string }[];
  /**
   * Years offered in a select. Omitted, the year is typed as a number (the
   * admin forms, which can file any year).
   */
  years?: number[];
  defaults: SittingDefaults;
  /** Label for the kind select; the legacy forms said "시험 형태". */
  kindLabel?: string;
  errors?: Record<string, string>;
};

/**
 * Kind, number and term pickers that name an exam sitting. The number field
 * is only needed for numbered kinds; without JavaScript it is always shown
 * and ignored for the others.
 */
export function SittingFields({
  kinds,
  semesters,
  years,
  defaults,
  kindLabel = "시험 형태",
  errors = {},
}: Props) {
  const [kindId, setKindId] = useState(defaults.kindId ?? kinds[0]?.id);
  const kind = kinds.find((k) => k.id === kindId);
  const yearOptions =
    years && !years.includes(defaults.year) ? [defaults.year, ...years] : years;

  return (
    <>
      <div className={s.kindRow}>
        <label>
          {kindLabel}
          <select
            name="kindId"
            defaultValue={defaults.kindId ?? undefined}
            onChange={(event) => setKindId(Number(event.target.value))}
          >
            {kinds.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
          {errors.kindId && <span className={s.error}>{errors.kindId}</span>}
        </label>
        <label
          className={s.number}
          data-needed={kind?.numbered ? "true" : "false"}
        >
          번호
          <input
            name="number"
            type="number"
            min={1}
            max={kind?.maxNumber ?? undefined}
            step={1}
            inputMode="numeric"
            placeholder={
              kind?.numbered ? `1~${kind.maxNumber ?? ""}` : "퀴즈·과제·시험만"
            }
            defaultValue={defaults.number ?? ""}
          />
          {errors.number && <span className={s.error}>{errors.number}</span>}
        </label>
      </div>
      <div className={s.termRow}>
        <label>
          연도
          {yearOptions ? (
            <select name="year" defaultValue={defaults.year}>
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          ) : (
            <input
              name="year"
              type="number"
              min={1980}
              max={2200}
              step={1}
              inputMode="numeric"
              required
              defaultValue={defaults.year}
            />
          )}
        </label>
        <label>
          학기
          <select name="semester" defaultValue={defaults.semester}>
            {semesters.map((semester) => (
              <option key={semester.value} value={semester.value}>
                {semester.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(errors.year || errors.semester) && (
        <span className={s.error}>{errors.year ?? errors.semester}</span>
      )}
    </>
  );
}
