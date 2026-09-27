import { useLocation } from "react-router";

import { apiContext, load } from "~/api/client.server";
import { MoreLink, pageEndpoint } from "~/components/admin/MoreLink";
import { ReportReviewCard } from "~/components/admin/ReportReviewCard";
import s from "~/components/admin/admin.module.css";
import { cursorOf, sittingOptions } from "~/lib/admin.server";
import { cx } from "~/lib/cx";
import { usePagedList } from "~/lib/usePagedList";
import ui from "~/styles/ui.module.css";
import type { Route } from "./+types/reports";

const PAGE_SIZE = 10;

export async function loader({ request, context }: Route.LoaderArgs) {
  const [page, options] = await Promise.all([
    // The legacy tab listed uploads of every status.
    load(
      context.get(apiContext).client.GET("/admin/reports", {
        params: {
          query: { status: "all", limit: PAGE_SIZE, cursor: cursorOf(request) },
        },
      }),
    ),
    sittingOptions(context),
  ]);
  return { page, ...options };
}

export default function Reports({ loaderData }: Route.ComponentProps) {
  const { page, kinds, semesters } = loaderData;
  const location = useLocation();
  const list = usePagedList(
    page,
    pageEndpoint(location.pathname, location.search),
    (data: typeof loaderData) => data.page,
  );

  return (
    <section
      className={cx(ui.panel, ui.sectionBlock)}
      aria-labelledby="reports-heading"
    >
      <div className={ui.sectionTitle}>
        <h2 id="reports-heading">간편 제보</h2>
        <span>
          {list.items.length}건{list.cursor ? "+" : ""}
        </span>
      </div>
      <div className={s.list}>
        {list.items.length === 0 ? (
          <div className={ui.emptySmall}>제보가 없습니다.</div>
        ) : (
          list.items.map((report) => (
            <ReportReviewCard
              key={report.id}
              report={report}
              kinds={kinds}
              semesters={semesters}
            />
          ))
        )}
      </div>
      <MoreLink {...list} />
    </section>
  );
}
