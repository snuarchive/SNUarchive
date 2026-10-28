import { useLocation } from "react-router";

import { apiContext, load } from "~/api/client.server";
import { MoreLink, pageEndpoint } from "~/components/admin/MoreLink";
import s from "~/components/admin/admin.module.css";
import { cursorOf } from "~/lib/admin.server";
import { cx } from "~/lib/cx";
import { formatDateTime } from "~/lib/format";
import { usePagedList } from "~/lib/usePagedList";
import ui from "~/styles/ui.module.css";
import type { Route } from "./+types/archive-runs";

const STATUS = {
  running: "실행 중",
  succeeded: "성공",
  failed: "실패",
} as const;

export async function loader({ request, context }: Route.LoaderArgs) {
  const page = await load(
    context.get(apiContext).client.GET("/admin/logs/archive-runs", {
      params: { query: { limit: 20, cursor: cursorOf(request) } },
    }),
  );
  return { page };
}

export default function ArchiveRuns({ loaderData }: Route.ComponentProps) {
  const location = useLocation();
  const list = usePagedList(
    loaderData.page,
    pageEndpoint(location.pathname, location.search),
    (data: typeof loaderData) => data.page,
  );

  return (
    <section
      className={cx(ui.panel, ui.sectionBlock)}
      aria-labelledby="runs-heading"
    >
      <div className={ui.sectionTitle}>
        <h2 id="runs-heading">Google Drive 보관 이력</h2>
      </div>
      {list.items.length === 0 ? (
        <div className={ui.emptySmall}>보관 이력이 없습니다.</div>
      ) : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>시작</th>
                <th>종료</th>
                <th>상태</th>
                <th>기준 시각</th>
                <th>형식</th>
                <th>행 수</th>
                <th>Drive 파일</th>
                <th>오류</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((run) => (
                <tr key={run.id}>
                  <td>{formatDateTime(run.startedAt)}</td>
                  <td>{formatDateTime(run.finishedAt)}</td>
                  <td>{STATUS[run.status]}</td>
                  <td>{formatDateTime(run.cutoff)}</td>
                  <td>{run.format}</td>
                  <td>{run.rowCount ?? "-"}</td>
                  <td>{run.driveFileId ?? "-"}</td>
                  <td>{run.error ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <MoreLink {...list} />
    </section>
  );
}
