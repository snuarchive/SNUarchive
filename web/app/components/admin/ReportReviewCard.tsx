import { Form, useLocation } from "react-router";

import type { Schemas } from "~/api/types";
import { SittingFields } from "~/components/course/SittingFields";
import { cx } from "~/lib/cx";
import { formatDate, termLabel } from "~/lib/format";
import { blockNumberKeys, cleanNumberPaste } from "~/lib/forms";
import ui from "~/styles/ui.module.css";
import s from "./ReportReviewCard.module.css";

type Report = Schemas["AdminPendingReport"];

type Props = {
  report: Report;
  kinds: Schemas["AssessmentKind"][];
  semesters: { value: number; label: string }[];
};

const STATUS_LABELS: Record<Report["status"], string> = {
  pending: "대기",
  approved: "승인",
  rejected: "반려",
};

function Viewer({ report }: { report: Report }) {
  const href = report.fileUrl;
  if (report.file.contentType.startsWith("image/")) {
    return (
      <div className={s.viewer}>
        <img src={href} alt={report.file.name} loading="lazy" />
      </div>
    );
  }
  return (
    <div className={s.viewer}>
      <iframe src={`${href}#toolbar=0&navpanes=0`} title={report.file.name} />
    </div>
  );
}

const FIGURES = [
  ["q1", "Q1"],
  ["q2", "Q2"],
  ["q3", "Q3"],
  ["q4", "Q4"],
  ["average", "평균"],
  ["maxScore", "만점"],
] as const;

export function ReportReviewCard({ report, kinds, semesters }: Props) {
  const location = useLocation();
  const pending = report.status === "pending";
  const action = `/admin/reports/${report.id}/review`;

  return (
    <article className={s.item}>
      <header>
        <div>
          <h3>{report.course.title}</h3>
          <p>
            {report.course.instructor} · {report.label} ·{" "}
            {termLabel(report.term, semesters)} · {report.nickname}
          </p>
          <p>
            {STATUS_LABELS[report.status]} · {formatDate(report.createdAt)}
          </p>
        </div>
        <a
          className={cx(ui.button, ui.subtle)}
          href={report.fileUrl}
          target="_blank"
          rel="noreferrer"
        >
          파일
        </a>
      </header>
      <Viewer report={report} />
      {pending && (
        <Form
          method="post"
          action={action}
          className={s.form}
          preventScrollReset
        >
          <input
            type="hidden"
            name="redirectTo"
            value={location.pathname + location.search}
          />
          <div className={s.sitting}>
            <SittingFields
              kinds={kinds}
              semesters={semesters}
              defaults={{
                kindId: report.kindId,
                number: report.number,
                year: report.term.year,
                semester: report.term.semester,
              }}
              kindLabel="시험"
            />
          </div>
          <div className={s.editGrid}>
            <label>
              닉네임
              <input
                name="nickname"
                maxLength={10}
                defaultValue={report.nickname}
              />
            </label>
            {FIGURES.map(([name, label]) => (
              <label key={name}>
                {label}
                <input
                  name={name}
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  onKeyDown={blockNumberKeys}
                  onPaste={cleanNumberPaste}
                />
              </label>
            ))}
            <label>
              메모
              <input name="reviewNote" maxLength={500} />
            </label>
          </div>
          <label>
            비고
            <textarea name="note" rows={2} maxLength={500} />
          </label>
          <div className={s.actions}>
            <button
              className={cx(ui.button, ui.primary)}
              type="submit"
              name="intent"
              value="approve"
            >
              승인 등록
            </button>
            <button
              className={cx(ui.button, ui.danger)}
              type="submit"
              name="intent"
              value="reject"
              formNoValidate
            >
              반려
            </button>
          </div>
        </Form>
      )}
    </article>
  );
}
