import { Form, Link, useLocation } from "react-router";

import { apiContext, failureOf, load } from "~/api/client.server";
import { MoreLink, pageEndpoint } from "~/components/admin/MoreLink";
import s from "~/components/admin/admin.module.css";
import { ACTION_LABELS, actionLabel, metadataText } from "~/lib/activity";
import { cursorOf } from "~/lib/admin.server";
import { cx } from "~/lib/cx";
import { failureText } from "~/lib/errors";
import { formatDate, formatDateTime } from "~/lib/format";
import { filterQuery, isEmptyFilter, readLogFilter } from "~/lib/logFilter";
import { usePagedList } from "~/lib/usePagedList";
import ui from "~/styles/ui.module.css";
import type { Route } from "./+types/entries";
import { pageUrl } from "~/lib/url.server";

const PAGE_SIZE = 50;
const FORMATS = ["json", "jsonl", "csv", "xlsx", "parquet"] as const;

export async function loader({ request, context }: Route.LoaderArgs) {
  const params = pageUrl(request).searchParams;
  const filter = readLogFilter(params);
  const result = await context.get(apiContext).client.GET("/admin/logs", {
    params: {
      query: { ...filter, limit: PAGE_SIZE, cursor: cursorOf(request) },
    },
  });
  // A bad filter (e.g. start after end) is the admin's to fix, not a failed
  // load: show it by the filter with an empty list.
  const failure = failureOf(result);
  if (failure?.status === 422) {
    return {
      page: { items: [], nextCursor: null },
      filtered: !isEmptyFilter(filter),
      filterError: failureText(failure.error, failure.fields),
    };
  }
  const page = await load(Promise.resolve(result));
  return { page, filtered: !isEmptyFilter(filter), filterError: null };
}

function FilterForm() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const selected = new Set(params.getAll("action"));
  return (
    <Form method="get" className={s.filters}>
      <label>
        시작(서울 시간)
        <input
          name="from"
          type="datetime-local"
          defaultValue={params.get("from") ?? ""}
        />
      </label>
      <label>
        끝(서울 시간, 미포함)
        <input
          name="until"
          type="datetime-local"
          defaultValue={params.get("until") ?? ""}
        />
      </label>
      <label>
        사용자 ID
        <input
          name="userId"
          type="number"
          min={1}
          defaultValue={params.get("userId") ?? ""}
        />
      </label>
      <label>
        활동(여러 개 선택 가능)
        <select name="action" multiple size={4} defaultValue={[...selected]}>
          {Object.entries(ACTION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className={s.actions}>
        <button className={cx(ui.button, ui.subtle)} type="submit">
          필터 적용
        </button>
        <Link className={cx(ui.button, ui.subtle)} to={location.pathname}>
          필터 지우기
        </Link>
      </div>
    </Form>
  );
}

export default function Entries({ loaderData }: Route.ComponentProps) {
  const location = useLocation();
  const query = filterQuery(new URLSearchParams(location.search));
  const list = usePagedList(
    loaderData.page,
    pageEndpoint(location.pathname, location.search),
    (data: typeof loaderData) => data.page,
  );

  return (
    <section
      className={cx(ui.panel, ui.sectionBlock)}
      aria-labelledby="logs-heading"
    >
      <div className={ui.sectionTitle}>
        <h2 id="logs-heading">로그 보기</h2>
        <span>
          {list.items.length}건{list.cursor ? "+" : ""}
        </span>
      </div>
      <FilterForm />
      {loaderData.filterError && (
        <p className={ui.fieldError} role="alert">
          {loaderData.filterError}
        </p>
      )}
      <div className={s.actions}>
        {/* Browser downloads through the same-origin API path. */}
        {FORMATS.map((format) => {
          const params = new URLSearchParams(exportQuery(location.search));
          params.set("format", format);
          return (
            <a
              key={format}
              className={cx(ui.button, ui.subtle)}
              href={`/api/v1/admin/logs/export?${params}`}
            >
              {format.toUpperCase()}로 내보내기
            </a>
          );
        })}
        {loaderData.filtered && (
          <Link
            className={cx(ui.button, ui.danger)}
            to={`/admin/logs/delete?${query}`}
          >
            필터에 맞는 로그 삭제
          </Link>
        )}
        <Link className={cx(ui.button, ui.danger)} to="/admin/logs/clear">
          비우기
        </Link>
      </div>
      <div className={s.list}>
        {list.items.length === 0 ? (
          <div className={ui.emptySmall}>로그가 없습니다.</div>
        ) : (
          list.items.map((log) => {
            const meta = metadataText(log.metadata);
            return (
              <article className={s.item} key={log.id}>
                <header>
                  <div>
                    <h3>{actionLabel(log.action)}</h3>
                    <p>
                      {log.user
                        ? `#${log.user.id}${log.user.displayName ? ` · ${log.user.displayName}` : ""}${log.user.deleted ? " (탈퇴)" : ""}`
                        : "시스템"}
                      {log.ip ? ` · ${log.ip}` : ""}
                    </p>
                    {meta && <p>{meta}</p>}
                  </div>
                  <time
                    dateTime={log.createdAt}
                    title={formatDateTime(log.createdAt)}
                  >
                    {formatDate(log.createdAt)}
                  </time>
                </header>
              </article>
            );
          })
        )}
      </div>
      <MoreLink {...list} />
    </section>
  );
}

/** The API's export query: the same filter in API form (ISO dates). */
function exportQuery(search: string): string {
  const filter = readLogFilter(new URLSearchParams(search));
  const params = new URLSearchParams();
  if (filter.from) params.set("from", filter.from);
  if (filter.until) params.set("until", filter.until);
  for (const action of filter.action ?? []) params.append("action", action);
  if (filter.userId) params.set("userId", String(filter.userId));
  return params.toString();
}

// Legacy defect: a failed log load showed an empty list. Show the failure.
export function ErrorBoundary() {
  return (
    <section
      className={cx(ui.panel, ui.sectionBlock)}
      aria-labelledby="logs-heading"
    >
      <div className={ui.sectionTitle}>
        <h2 id="logs-heading">로그 보기</h2>
      </div>
      <div className={ui.emptySmall} role="alert">
        로그를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.
      </div>
    </section>
  );
}
