import { Fragment } from "react";

import type { Schemas } from "~/api/types";
import { cx } from "~/lib/cx";
import { displayNumber, termLabel } from "~/lib/format";
import ui from "~/styles/ui.module.css";
import s from "./StatsSection.module.css";
import { StatGraph } from "./StatGraph";

type Props = {
  sittings: Schemas["Sitting"][];
  semesters: { value: number; label: string }[];
  className?: string;
};

const valueOrDash = (value: number | null) => displayNumber(value);

/** Every visible statistic of the course, with its sitting as the first two columns. */
export function StatsSection({ sittings, semesters, className }: Props) {
  const rows = sittings.flatMap((sitting) =>
    sitting.statistics.map((stat) => ({ sitting, stat })),
  );

  return (
    <section
      className={cx(ui.panel, ui.sectionBlock, className)}
      aria-labelledby="stats-heading"
    >
      <div className={ui.sectionTitle}>
        <h2 id="stats-heading">통계량</h2>
        <span>{rows.length}건</span>
      </div>
      <div className={s.wrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>시험</th>
              <th>연도/학기</th>
              <th>Q1</th>
              <th>Q2</th>
              <th>Q3</th>
              <th>Q4</th>
              <th>평균</th>
              <th>만점</th>
              <th>제보자</th>
              <th>비고</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10}>등록된 통계량이 없습니다.</td>
              </tr>
            ) : (
              rows.map(({ sitting, stat }) => (
                <Fragment key={stat.id}>
                  <tr className={s.dataRow}>
                    <td data-label="시험">{sitting.label}</td>
                    <td data-label="연도/학기">
                      {termLabel(sitting.term, semesters)}
                    </td>
                    <td data-label="Q1">{valueOrDash(stat.q1)}</td>
                    <td data-label="Q2">{valueOrDash(stat.q2)}</td>
                    <td data-label="Q3">{valueOrDash(stat.q3)}</td>
                    <td data-label="Q4">{valueOrDash(stat.q4)}</td>
                    <td data-label="평균">{valueOrDash(stat.average)}</td>
                    <td data-label="만점">{valueOrDash(stat.maxScore)}</td>
                    <td data-label="제보자">{stat.nickname || "(익명)"}</td>
                    <td
                      data-label="비고"
                      className={s.note}
                      title={stat.note ?? ""}
                    >
                      {stat.note || "-"}
                    </td>
                  </tr>
                  <tr className={s.graphRow}>
                    <td data-label="분포" className={s.graphCell} colSpan={10}>
                      <StatGraph {...stat} />
                    </td>
                  </tr>
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
