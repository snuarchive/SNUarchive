import { Form, useSubmit } from "react-router";

import type { Schemas } from "~/api/types";
import { cx } from "~/lib/cx";
import { formatDateTime, RATING_LABELS, termLabel } from "~/lib/format";
import { useFailure } from "~/lib/forms";
import ui from "~/styles/ui.module.css";
import s from "./PollSection.module.css";
import { SittingFields, type SittingDefaults } from "./SittingFields";

type Sitting = Schemas["Sitting"];

type Props = {
  sittings: Sitting[];
  selected: Sitting | null;
  /** Pre-fills the request form when no sitting is selected. */
  requestDefaults: SittingDefaults;
  kinds: Schemas["AssessmentKind"][];
  semesters: { value: number; label: string }[];
  years: number[];
  noteMaxLength: number;
  q: string;
  errors?: Record<string, string>;
  className?: string;
};

export function PollSection(props: Props) {
  const { sittings, selected, semesters, q, className } = props;
  const submit = useSubmit();

  return (
    <section
      className={cx(ui.panel, ui.sectionBlock, className)}
      aria-labelledby="poll-heading"
    >
      <div className={ui.sectionTitle}>
        <h2 id="poll-heading">난이도 투표</h2>
      </div>
      <div className={s.box}>
        {sittings.length > 0 && (
          <Form method="get" className={s.picker} preventScrollReset>
            {q && <input type="hidden" name="q" value={q} />}
            <label>
              시험
              <select
                name="sitting"
                defaultValue={selected?.id}
                key={selected?.id}
                onChange={(event) =>
                  submit(event.currentTarget.form, {
                    replace: true,
                    preventScrollReset: true,
                  })
                }
              >
                {sittings.map((sitting) => (
                  <option key={sitting.id} value={sitting.id}>
                    {termLabel(sitting.term, semesters)} {sitting.label}
                    {sitting.voting.isOpen ? " · 투표중" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={cx(ui.button, ui.subtle, s.pickButton)}
              type="submit"
            >
              보기
            </button>
          </Form>
        )}
        {selected?.voting.isOpen ? (
          <OpenPoll sitting={selected} />
        ) : (
          <ClosedPoll {...props} />
        )}
        <PollFailure />
      </div>
    </section>
  );
}

/** A refused vote, request or cancellation, shown under the section. */
function PollFailure() {
  const vote = useFailure("vote");
  const request = useFailure("request");
  const cancel = useFailure("cancel-request");
  const failure = vote ?? request ?? cancel;
  return failure ? (
    <p className={ui.fieldError} role="alert">
      {failure.message}
    </p>
  ) : null;
}

function closesText(voting: Sitting["voting"]): string {
  return voting.closesAt
    ? `${formatDateTime(voting.closesAt)} 종료`
    : "마감 없음";
}

function Summary({ sitting }: { sitting: Sitting }) {
  const { difficulty } = sitting;
  const max = Math.max(1, ...difficulty.distribution);
  return (
    <div className={s.summary}>
      <div className={s.score}>
        <span>{sitting.label} 난이도</span>
        <strong>{difficulty.average ?? "-"}</strong>
        <span>{difficulty.voteCount}표</span>
      </div>
      <div className={s.bars}>
        {RATING_LABELS.map((label, index) => {
          const count = difficulty.distribution[index] ?? 0;
          return (
            <div className={s.barRow} key={label}>
              <span>{label}</span>
              <div className={s.barTrack}>
                <div
                  className={s.barFill}
                  style={{ width: `${Math.round((count / max) * 100)}%` }}
                />
              </div>
              <span>{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OpenPoll({ sitting }: { sitting: Sitting }) {
  return (
    <>
      <div className={s.status}>
        <strong>{sitting.label} 난이도 투표 진행중</strong>
        <span>{closesText(sitting.voting)}</span>
      </div>
      <Summary sitting={sitting} />
      <Form method="post" className={s.ratingArea} preventScrollReset>
        <input type="hidden" name="intent" value="vote" />
        <input type="hidden" name="sittingId" value={sitting.id} />
        <fieldset className={s.ratingButtons} aria-label="난이도 선택">
          {RATING_LABELS.map((label, index) => (
            <label key={label} className={s.rating}>
              <input
                type="radio"
                name="rating"
                value={index + 1}
                required
                defaultChecked={sitting.myRating === index + 1}
                className="sr-only"
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <button className={cx(ui.button, ui.primary)} type="submit">
          {sitting.myRating ? "다시 투표" : "투표"}
        </button>
        <span className={ui.muted}>{closesText(sitting.voting)}</span>
      </Form>
    </>
  );
}

function ClosedPoll({
  selected,
  requestDefaults,
  kinds,
  semesters,
  years,
  noteMaxLength,
  errors,
}: Props) {
  const mine = selected?.votingRequests.mine ?? null;
  const defaults: SittingDefaults = selected
    ? {
        kindId: selected.kindId,
        number: selected.number,
        year: selected.term.year,
        semester: selected.term.semester,
      }
    : requestDefaults;

  return (
    <>
      {selected &&
      (selected.difficulty.voteCount > 0 ||
        selected.voting.state === "closed") ? (
        <Summary sitting={selected} />
      ) : (
        <div className={ui.emptySmall}>
          {selected ? `${selected.label} ` : ""}난이도 투표 결과가 없습니다.
        </div>
      )}

      {mine ? (
        <Form method="post" className={s.requestState} preventScrollReset>
          <input type="hidden" name="intent" value="cancel-request" />
          <input type="hidden" name="requestId" value={mine.id} />
          <span>
            {mine.sitting.label} 투표를 요청했습니다 · 요청{" "}
            {selected?.votingRequests.openCount ?? 1}건
          </span>
          <button className={cx(ui.button, ui.subtle)} type="submit">
            요청 취소
          </button>
        </Form>
      ) : (
        <Form method="post" className={s.requestPanel} preventScrollReset>
          <input type="hidden" name="intent" value="request" />
          <div className={s.requestFields}>
            <SittingFields
              key={selected?.id ?? "new"}
              kinds={kinds}
              semesters={semesters}
              years={years}
              defaults={defaults}
              kindLabel="투표 대상"
              errors={errors}
            />
          </div>
          <label>
            메모(선택)
            <input
              name="note"
              maxLength={noteMaxLength}
              placeholder="예: 시험일 10/20"
              autoComplete="off"
            />
          </label>
          <div className={s.requestSubmit}>
            {selected && selected.votingRequests.openCount > 0 && (
              <span className={ui.muted}>
                요청 {selected.votingRequests.openCount}건
              </span>
            )}
            <button className={cx(ui.button, ui.primary)} type="submit">
              투표 요청
            </button>
          </div>
        </Form>
      )}
    </>
  );
}
