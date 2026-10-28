import { Link } from "react-router";

import { apiContext, load } from "~/api/client.server";
import s from "~/components/admin/admin.module.css";
import { cx } from "~/lib/cx";
import { formatDate, formatDateTime, termLabel } from "~/lib/format";
import { getConfig } from "~/lib/viewer.server";
import ui from "~/styles/ui.module.css";
import type { Route } from "./+types/dashboard";

export async function loader({ context }: Route.LoaderArgs) {
  const [dashboard, config] = await Promise.all([
    load(context.get(apiContext).client.GET("/admin/dashboard")),
    getConfig(context),
  ]);
  // Day labels are fixed here, once, so server and browser render the same
  // dates even across midnight.
  return {
    dashboard,
    semesters: config.semesters,
    trend: trendRows(dashboard.trend, Date.now()),
  };
}

function Figure({
  label,
  value,
  to,
}: {
  label: string;
  value: number | string;
  to?: string;
}) {
  return (
    <div className={s.figure}>
      <span>{label}</span>
      <strong>{to ? <Link to={to}>{value}</Link> : value}</strong>
    </div>
  );
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/**
 * Rows for the trend table, newest first; the API sends one bucket per
 * Seoul day, oldest first, ending today.
 */
function trendRows(
  trend: {
    days: number;
    statistics: number[];
    votes: number[];
    uploads: number[];
  },
  today: number,
) {
  return trend.statistics
    .map((_, i) => ({
      day: formatDate(
        new Date(today - (trend.days - 1 - i) * 86_400_000).toISOString(),
      ),
      statistics: trend.statistics[i],
      votes: trend.votes[i] ?? 0,
      uploads: trend.uploads[i] ?? 0,
    }))
    .reverse();
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const { dashboard: d, semesters, trend } = loaderData;
  return (
    <>
      <section
        className={cx(ui.panel, ui.sectionBlock)}
        aria-labelledby="queue-heading"
      >
        <div className={ui.sectionTitle}>
          <h2 id="queue-heading">처리 대기</h2>
        </div>
        <div className={s.figures}>
          <Figure
            label="검토 대기 제보"
            value={d.queue.pendingUploads}
            to="/admin/review/reports"
          />
          <Figure
            label="가장 오래된 제보"
            value={formatDateTime(d.queue.oldestPendingUploadAt)}
          />
          <Figure
            label="투표 요청 (회차)"
            value={d.queue.openVotingRequests}
            to="/admin/voting/requests"
          />
          <Figure
            label="가장 오래된 요청"
            value={formatDateTime(d.queue.oldestVotingRequestAt)}
          />
        </div>
      </section>

      <section
        className={cx(ui.panel, ui.sectionBlock)}
        aria-labelledby="term-heading"
      >
        <div className={ui.sectionTitle}>
          <h2 id="term-heading">{termLabel(d.term, semesters)}</h2>
        </div>
        <div className={s.figures}>
          <Figure label="통계량" value={d.thisTerm.statistics} />
          <Figure label="투표" value={d.thisTerm.votes} />
          <Figure label="한줄 후기" value={d.thisTerm.comments} />
          <Figure label="간편 제보" value={d.thisTerm.uploads} />
          <Figure
            label="투표 중"
            value={d.voting.openCount}
            to="/admin/voting/sittings"
          />
          <Figure label="마감 없는 투표" value={d.voting.openEndedCount} />
          <Figure label="24시간 안에 마감" value={d.voting.closingWithin24h} />
        </div>
      </section>

      <section
        className={cx(ui.panel, ui.sectionBlock)}
        aria-labelledby="coverage-heading"
      >
        <div className={ui.sectionTitle}>
          <h2 id="coverage-heading">범위·사용자</h2>
        </div>
        <div className={s.figures}>
          <Figure label="검색 노출 강의" value={d.coverage.listedCourses} />
          <Figure label="통계 있는 강의" value={d.coverage.withStatistics} />
          <Figure label="투표 있는 강의" value={d.coverage.withVotes} />
          <Figure label="사용자" value={d.users.total} />
          <Figure label="이번 학기 접속" value={d.users.activeThisTerm} />
          <Figure
            label="관리자"
            value={d.users.admins}
            to="/admin/users/admins"
          />
        </div>
      </section>

      <section
        className={cx(ui.panel, ui.sectionBlock)}
        aria-labelledby="trend-heading"
      >
        <div className={ui.sectionTitle}>
          <h2 id="trend-heading">최근 {d.trend.days}일</h2>
          <span>
            통계량 {sum(d.trend.statistics)} · 투표 {sum(d.trend.votes)} · 간편
            제보 {sum(d.trend.uploads)}
          </span>
        </div>
        <details>
          <summary className={ui.muted}>날짜별 보기</summary>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>통계량</th>
                  <th>투표</th>
                  <th>간편 제보</th>
                </tr>
              </thead>
              <tbody>
                {trend.map((row) => (
                  <tr key={row.day}>
                    <td>{row.day}</td>
                    <td>{row.statistics}</td>
                    <td>{row.votes}</td>
                    <td>{row.uploads}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </>
  );
}
