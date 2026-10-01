import { apiContext, load } from "~/api/client.server";
import { StatBars } from "~/components/admin/StatBars";
import { cx } from "~/lib/cx";
import ui from "~/styles/ui.module.css";
import type { Route } from "./+types/summary";

export async function loader({ context }: Route.LoaderArgs) {
  return load(context.get(apiContext).client.GET("/admin/users/summary"));
}

export default function Summary({ loaderData }: Route.ComponentProps) {
  const summary = loaderData;
  return (
    <section
      className={cx(ui.panel, ui.sectionBlock)}
      aria-labelledby="college-heading"
    >
      <div className={ui.sectionTitle}>
        <h2 id="college-heading">학과별 사용자 수</h2>
        <span>
          입력 {summary.withProfile}명 · 전체 {summary.totalUsers}명
        </span>
      </div>
      <StatBars
        rows={summary.byCollege.map((row) => ({
          label: row.college,
          count: row.count,
        }))}
        empty="아직 입력된 학과 정보가 없습니다."
      />
      <div className={ui.sectionTitle}>
        <h2>입학년도별 사용자 수</h2>
      </div>
      <StatBars
        rows={summary.byAdmissionYear.map((row) => ({
          label: `${row.year}학번`,
          count: row.count,
        }))}
        empty="아직 입력된 입학년도 정보가 없습니다."
      />
    </section>
  );
}
