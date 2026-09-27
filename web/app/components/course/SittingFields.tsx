import { useId, useState } from "react";

import { errorAttrs, FieldError } from "~/components/FieldError";

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
  const idBase = useId();
  const errorId = (name: string) => `${idBase}-${name}-error`;
  const termError = errors.year ?? errors.semester;
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
            {...errorAttrs(errorId("kindId"), errors.kindId)}
          >
            {kinds.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
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
            {...errorAttrs(errorId("number"), errors.number)}
          />
        </label>
      </div>
      <FieldError id={errorId("kindId")} message={errors.kindId} />
      <FieldError id={errorId("number")} message={errors.number} />
      <div className={s.termRow}>
        <label>
          연도
          {yearOptions ? (
            <select
              name="year"
              defaultValue={defaults.year}
              {...errorAttrs(errorId("term"), termError)}
            >
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
              {...errorAttrs(errorId("term"), termError)}
            />
          )}
        </label>
        <label>
          학기
          <select
            name="semester"
            defaultValue={defaults.semester}
            {...errorAttrs(errorId("term"), termError)}
          >
            {semesters.map((semester) => (
              <option key={semester.value} value={semester.value}>
                {semester.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <FieldError id={errorId("term")} message={termError} />
    </>
  );
}
