import { apiContext, load } from "~/api/client.server";
import s from "~/components/admin/admin.module.css";
import { cx } from "~/lib/cx";
import { formatDateTime } from "~/lib/format";
import ui from "~/styles/ui.module.css";
import type { Route } from "./+types/catalog";

const STATUS = {
  running: "실행 중",
  succeeded: "성공",
  failed: "실패",
} as const;

export async function loader({ context }: Route.LoaderArgs) {
  return load(context.get(apiContext).client.GET("/admin/catalog"));
}

export default function Catalog({ loaderData }: Route.ComponentProps) {
  const { lastImport: run, listedCourses, totalCourses } = loaderData;
  return (
    <section
      className={cx(ui.panel, ui.sectionBlock)}
      aria-labelledby="catalog-heading"
    >
      <div className={ui.sectionTitle}>
        <h2 id="catalog-heading">강의 카탈로그</h2>
        <span>가져오기는 서버의 `snuarchive import` 명령으로만 실행됩니다</span>
      </div>
      <div className={s.figures}>
        <div className={s.figure}>
          <span>검색 노출 강의</span>
          <strong>{listedCourses}</strong>
        </div>
        <div className={s.figure}>
          <span>전체 강의</span>
          <strong>{totalCourses}</strong>
        </div>
      </div>
      {run ? (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <tbody>
              <tr>
                <th>마지막 가져오기</th>
                <td>
                  {STATUS[run.status]} · {formatDateTime(run.startedAt)} ~{" "}
                  {formatDateTime(run.finishedAt)}
                </td>
              </tr>
              <tr>
                <th>원본</th>
                <td>{run.sourceLabel ?? "-"}</td>
              </tr>
              <tr>
                <th>강의</th>
                <td>
                  전체 {run.coursesTotal ?? "-"} · 추가{" "}
                  {run.coursesAdded ?? "-"} · 노출 해제{" "}
                  {run.coursesUnlisted ?? "-"}
                </td>
              </tr>
              <tr>
                <th>개설·분반</th>
                <td>
                  {run.offeringsTotal ?? "-"} · {run.sectionsTotal ?? "-"}
                </td>
              </tr>
              {run.error && (
                <tr>
                  <th>오류</th>
                  <td>{run.error}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={ui.emptySmall}>가져오기 기록이 없습니다.</div>
      )}
    </section>
  );
}
