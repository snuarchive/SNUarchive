import { useEffect, useId, useRef, useState } from "react";
import { Form } from "react-router";

import type { Schemas } from "~/api/types";
import { errorAttrs, FieldError } from "~/components/FieldError";
import { cx } from "~/lib/cx";
import {
  blockNumberKeys,
  cleanNumberPaste,
  useFailure,
  useResetOnSuccess,
} from "~/lib/forms";
import { useHydrated } from "~/lib/hydrated";
import {
  DIRECT_DRAFT_KEY,
  loadDraft,
  NICKNAME_KEY,
  savedNickname,
  storageRemove,
  storageSet,
} from "~/lib/storage";
import ui from "~/styles/ui.module.css";
import s from "./ReportForms.module.css";
import { SittingFields, type SittingDefaults } from "./SittingFields";

type Shared = {
  courseId: number;
  kinds: Schemas["AssessmentKind"][];
  semesters: { value: number; label: string }[];
  years: number[];
  defaults: SittingDefaults;
};

const FIGURES = [
  ["q1", "Q1"],
  ["q2", "Q2"],
  ["q3", "Q3"],
  ["q4", "Q4"],
  ["average", "평균"],
  ["maxScore", "만점"],
] as const;

/** Fields a draft restores; kind and term are included so they come back too. */
const DRAFT_FIELDS = [
  "nickname",
  "kindId",
  "number",
  "year",
  "semester",
  "q1",
  "q2",
  "q3",
  "q4",
  "average",
  "maxScore",
  "note",
];
const USER_INPUT_FIELDS = [
  "nickname",
  "number",
  "q1",
  "q2",
  "q3",
  "q4",
  "average",
  "maxScore",
  "note",
];

function fieldValue(form: HTMLFormElement, name: string): string {
  const field = form.elements.namedItem(name);
  return field instanceof HTMLInputElement ||
    field instanceof HTMLSelectElement ||
    field instanceof HTMLTextAreaElement
    ? field.value
    : "";
}

function hasFigures(form: HTMLFormElement): boolean {
  return [...FIGURES.map(([name]) => name), "note"].some((name) =>
    fieldValue(form, name).trim(),
  );
}

function rememberNickname(form: HTMLFormElement) {
  const nickname = fieldValue(form, "nickname").trim();
  if (nickname) storageSet(NICKNAME_KEY, [...nickname].slice(0, 10).join(""));
}

/** After a reset the form is cleared once the event returns; refill then. */
function refillNicknameAfterReset(form: HTMLFormElement) {
  setTimeout(() => {
    const field = form.elements.namedItem("nickname");
    if (field instanceof HTMLInputElement && !field.value) {
      field.value = savedNickname();
    }
  });
}

function useSavedNickname(form: React.RefObject<HTMLFormElement | null>) {
  useEffect(() => {
    const field = form.current?.elements.namedItem("nickname");
    if (field instanceof HTMLInputElement && !field.value)
      field.value = savedNickname();
  }, [form]);
}

function CardHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <summary className={cx(ui.sectionTitle, s.summary)}>
      <div>
        <h2>{title}</h2>
        <span>{subtitle}</span>
      </div>
      <span
        className={cx(ui.button, ui.iconButton, s.toggle)}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </span>
    </summary>
  );
}

export function DirectReport({
  courseId,
  kinds,
  semesters,
  years,
  defaults,
}: Shared) {
  const form = useRef<HTMLFormElement>(null);
  const card = useRef<HTMLDetailsElement>(null);
  const failure = useFailure("statistic");
  const hydrated = useHydrated();
  const [hasContent, setHasContent] = useState(false);
  useResetOnSuccess(form, "statistic");
  useSavedNickname(form);

  // Restore this course's draft (legacy behaviour), and open the card if it
  // holds anything the user typed.
  useEffect(() => {
    const node = form.current;
    if (!node) return;
    const draft = loadDraft();
    if (draft && draft.courseId === courseId) {
      for (const [name, value] of Object.entries(draft.values)) {
        const field = node.elements.namedItem(name);
        if (field && "value" in field && typeof value === "string")
          field.value = value;
      }
      // Let SittingFields see the restored kind, and onChange below re-check
      // the submit button and re-save the draft.
      const kindSelect = node.elements.namedItem("kindId");
      if (kindSelect instanceof HTMLSelectElement) {
        kindSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (
        USER_INPUT_FIELDS.some((name) => draft.values[name]?.trim()) &&
        card.current
      ) {
        card.current.open = true;
      }
    }
  }, [courseId]);

  const onChange = () => {
    const node = form.current;
    if (!node) return;
    setHasContent(hasFigures(node));
    const values = Object.fromEntries(
      DRAFT_FIELDS.map((name) => [name, fieldValue(node, name)]),
    );
    storageSet(
      DIRECT_DRAFT_KEY,
      JSON.stringify({ courseId, values, savedAt: new Date().toISOString() }),
    );
  };

  const values = failure?.values ?? {};
  const errors = failure?.fields ?? {};
  const idBase = useId();
  const errorId = (name: string) => `${idBase}-${name}-error`;

  return (
    <details
      ref={card}
      className={cx(ui.panel, ui.sectionBlock, s.card)}
      open={failure ? true : undefined}
    >
      <CardHeading
        title="직접 제보"
        subtitle="비어 있는 값은 저장하지 않습니다"
      />
      <Form
        ref={form}
        method="post"
        className={s.body}
        onChange={onChange}
        onReset={(event) => {
          setHasContent(false);
          refillNicknameAfterReset(event.currentTarget);
        }}
        onSubmit={(event) => {
          rememberNickname(event.currentTarget);
          storageRemove(DIRECT_DRAFT_KEY);
        }}
        preventScrollReset
      >
        <input type="hidden" name="intent" value="statistic" />
        <label>
          닉네임
          <input
            name="nickname"
            maxLength={10}
            placeholder="(익명)"
            defaultValue={values.nickname}
          />
        </label>
        <SittingFields
          kinds={kinds}
          semesters={semesters}
          years={years}
          defaults={
            failure
              ? {
                  kindId: Number(values.kindId) || defaults.kindId,
                  number: Number(values.number) || null,
                  year: Number(values.year) || defaults.year,
                  semester: Number(values.semester) || defaults.semester,
                }
              : defaults
          }
          errors={errors}
        />
        <div className={s.scoreStrip}>
          {FIGURES.map(([name, label]) => (
            <div key={name} className={s.field}>
              <label>
                {label}
                <input
                  name={name}
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  onKeyDown={blockNumberKeys}
                  onPaste={cleanNumberPaste}
                  defaultValue={values[name]}
                  {...errorAttrs(errorId(name), errors[name])}
                />
              </label>
              <FieldError id={errorId(name)} message={errors[name]} />
            </div>
          ))}
        </div>
        <div className={s.submitRow}>
          <div className={s.field}>
            <label>
              비고
              <textarea
                name="note"
                rows={2}
                maxLength={500}
                defaultValue={values.note}
                {...errorAttrs(errorId("note"), errors.note)}
              />
            </label>
            <FieldError id={errorId("note")} message={errors.note} />
          </div>
          <button
            className={cx(ui.button, ui.primary)}
            type="submit"
            disabled={hydrated && !hasContent}
          >
            등록
          </button>
        </div>
        {failure && <p className={ui.fieldError}>{failure.message}</p>}
      </Form>
    </details>
  );
}

type QuickProps = Shared & { upload: { maxBytes: number; accepts: string[] } };

export function QuickReport({
  kinds,
  semesters,
  years,
  defaults,
  upload,
}: QuickProps) {
  const form = useRef<HTMLFormElement>(null);
  const failure = useFailure("upload");
  const hydrated = useHydrated();
  const [hasFile, setHasFile] = useState(false);
  useResetOnSuccess(form, "upload");
  useSavedNickname(form);

  const limitMb = Math.round(upload.maxBytes / 1024 / 1024);
  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    setHasFile(Boolean(file));
    input.setCustomValidity(
      file && file.size > upload.maxBytes
        ? `파일은 ${limitMb}MB 이하만 가능합니다.`
        : "",
    );
    input.reportValidity();
  };

  return (
    <details
      className={cx(ui.panel, ui.sectionBlock, s.card)}
      open={failure ? true : undefined}
    >
      <CardHeading title="간편 제보" subtitle="관리자 확인 후 반영됩니다" />
      <Form
        ref={form}
        method="post"
        encType="multipart/form-data"
        className={s.body}
        onSubmit={(event) => rememberNickname(event.currentTarget)}
        onReset={(event) => {
          setHasFile(false);
          refillNicknameAfterReset(event.currentTarget);
        }}
        preventScrollReset
      >
        <input type="hidden" name="intent" value="upload" />
        <label>
          닉네임
          <input name="nickname" maxLength={10} placeholder="(익명)" />
        </label>
        <SittingFields
          kinds={kinds}
          semesters={semesters}
          years={years}
          defaults={defaults}
          errors={failure?.fields}
        />
        <label>
          파일
          <input
            name="file"
            type="file"
            accept={upload.accepts.join(",")}
            required
            onChange={onFile}
          />
        </label>
        {failure && <p className={ui.fieldError}>{failure.message}</p>}
        <button
          className={cx(ui.button, ui.primary)}
          type="submit"
          disabled={hydrated && !hasFile}
        >
          업로드
        </button>
      </Form>
    </details>
  );
}
