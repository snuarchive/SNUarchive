import { apiContext, load } from "~/api/client.server";
import s from "~/components/admin/admin.module.css";
import { cx } from "~/lib/cx";
import { formatDateTime } from "~/lib/format";
import ui from "~/styles/ui.module.css";
import type { Route } from "./+types/jobs";

const JOB_LABELS = {
  retention: "로그 보존 기간 삭제",
  archive: "로그 Drive 보관",
  "upload-gc": "업로드 찌꺼기 정리",
} as const;
const RUN_STATUS = {
  succeeded: "성공",
  failed: "실패",
  skipped: "건너뜀",
} as const;

export async function loader({ context }: Route.LoaderArgs) {
  return load(context.get(apiContext).client.GET("/admin/jobs"));
}

export default function Jobs({ loaderData }: Route.ComponentProps) {
  const { schedulerEnabled, items } = loaderData;
  return (
    <section
      className={cx(ui.panel, ui.sectionBlock)}
      aria-labelledby="jobs-heading"
    >
      <div className={ui.sectionTitle}>
        <h2 id="jobs-heading">예약 작업</h2>
        <span>
          {schedulerEnabled ? "서버 내 스케줄러 사용" : "외부 cron 호출"} · 켜고
          끄기는 서버 설정으로
        </span>
      </div>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>작업</th>
              <th>상태</th>
              <th>설정</th>
              <th>마지막 실행</th>
            </tr>
          </thead>
          <tbody>
            {items.map((job) => (
              <tr key={job.name}>
                <td>{JOB_LABELS[job.name] ?? job.name}</td>
                <td>{job.enabled ? "켜짐" : "꺼짐"}</td>
                <td>
                  <pre className={s.metadata}>
                    {JSON.stringify(job.settings, null, 2)}
                  </pre>
                </td>
                <td>
                  {job.lastRun
                    ? `${RUN_STATUS[job.lastRun.status]} · ${formatDateTime(job.lastRun.finishedAt)} · ${job.lastRun.affected}건${job.lastRun.error ? ` · ${job.lastRun.error}` : ""}`
                    : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
