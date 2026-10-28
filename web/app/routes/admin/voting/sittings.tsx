import { Form, Link, useLocation, useSubmit } from "react-router";

import { apiContext, failureOf, load, type Schemas } from "~/api/client.server";
import { MoreLink, pageEndpoint } from "~/components/admin/MoreLink";
import s from "~/components/admin/admin.module.css";
import {
  CoursePicker,
  CourseSearchForm,
} from "~/components/admin/CoursePicker";
import { SittingFields } from "~/components/course/SittingFields";
import { courseSearch, cursorOf, sittingOptions } from "~/lib/admin.server";
import { cx } from "~/lib/cx";
import { errorMessage } from "~/lib/errors";
import { flashContext } from "~/lib/flash.server";
import { formatDateTime, termLabel } from "~/lib/format";
import { back } from "~/lib/redirect.server";
import { fromSeoulInput, toSeoulInput } from "~/lib/seoulTime";
import { readSittingKey } from "~/lib/sittings";
import { getConfig } from "~/lib/viewer.server";
import { usePagedList } from "~/lib/usePagedList";
import ui from "~/styles/ui.module.css";
import type { Route } from "./+types/sittings";
import { pageUrl } from "~/lib/url.server";

const PAGE_SIZE = 20;
const STATES = [
  ["open", "투표 중"],
  ["closed", "종료"],
  ["never", "연 적 없음"],
  ["any", "전체"],
] as const;
type VotingState = (typeof STATES)[number][0];

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = pageUrl(request);
  const requested = url.searchParams.get("state");
  const state: VotingState = STATES.some(([v]) => v === requested)
    ? (requested as VotingState)
    : "open";
  const [page, options] = await Promise.all([
    load(
      context.get(apiContext).client.GET("/admin/sittings", {
        params: {
          query: {
            votingState: state,
            limit: PAGE_SIZE,
            cursor: cursorOf(request),
          },
        },
      }),
    ),
    sittingOptions(context),
  ]);
  return {
    state,
    page,
    ...options,
    courseResults: await courseSearch(request, context),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const client = context.get(apiContext).client;
  const flash = context.get(flashContext);
  const sittingId = Number(form.get("sittingId"));
  const path = { sittingId };
  const closesAt = fromSeoulInput(String(form.get("closesAt") ?? ""));
  let result;
  let success: string;

  switch (form.get("intent")) {
    case "open":
      result = await client.POST("/admin/sittings/{sittingId}/voting", {
        params: { path },
        body: { closesAt },
      });
      success = "투표를 열었습니다.";
      break;
    case "deadline":
      result = await client.PATCH("/admin/sittings/{sittingId}/voting", {
        params: { path },
        body: { closesAt },
      });
      success = "마감 시각을 바꿨습니다.";
      break;
    case "close":
      result = await client.POST("/admin/sittings/{sittingId}/voting/close", {
        params: { path },
      });
      success = "투표를 종료했습니다.";
      break;
    case "create": {
      const config = await getConfig(context);
      const key = readSittingKey(form, config.assessmentKinds);
      const courseId = Number(form.get("courseId"));
      if (!key || !Number.isInteger(courseId) || courseId < 1) {
        flash.put("강의와 시험 정보를 확인해주세요.", "error");
        return back(form, "/admin/voting/sittings");
      }
      const openNow = form.get("openNow") === "on";
      result = await client.POST("/admin/courses/{courseId}/sittings", {
        params: { path: { courseId } },
        body: { ...key, ...(openNow ? { openVoting: { closesAt } } : {}) },
      });
      success = openNow
        ? "회차를 만들고 투표를 열었습니다."
        : "회차를 만들었습니다.";
      break;
    }
    default:
      return back(form, "/admin/voting/sittings");
  }

  const failure = failureOf(result);
  if (failure) flash.put(errorMessage(failure.error), "error");
  else flash.put(success);
  return back(form, "/admin/voting/sittings");
}

type Sitting = Schemas["AdminSitting"];

function votingText(voting: Sitting["voting"]): string {
  if (voting.state === "never") return "연 적 없음";
  if (voting.state === "closed") {
    return `종료${voting.endedAt ? ` ${formatDateTime(voting.endedAt)}` : ""}`;
  }
  return voting.closesAt
    ? `${formatDateTime(voting.closesAt)} 마감`
    : "마감 없음";
}

export default function Sittings({ loaderData }: Route.ComponentProps) {
  const { state, page, kinds, semesters, currentYear, courseResults } =
    loaderData;
  const location = useLocation();
  const submit = useSubmit();
  const here = location.pathname + location.search;
  const list = usePagedList(
    page,
    pageEndpoint(location.pathname, location.search),
    (data: typeof loaderData) => data.page,
  );

  return (
    <>
      <section
        className={cx(ui.panel, ui.sectionBlock)}
        aria-labelledby="sittings-heading"
      >
        <div className={ui.sectionTitle}>
          <h2 id="sittings-heading">시험 회차</h2>
          <Form method="get" className={s.inline}>
            <label>
              투표 상태
              <select
                name="state"
                defaultValue={state}
                onChange={(event) =>
                  submit(event.currentTarget.form, { replace: true })
                }
              >
                {STATES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={cx(ui.button, ui.subtle, "no-js-only")}
              type="submit"
            >
              보기
            </button>
          </Form>
        </div>
        <div className={s.list}>
          {list.items.length === 0 ? (
            <div className={ui.emptySmall}>해당하는 회차가 없습니다.</div>
          ) : (
            list.items.map((sitting) => (
              <SittingCard
                key={sitting.id}
                sitting={sitting}
                here={here}
                semesters={semesters}
              />
            ))
          )}
        </div>
        <MoreLink {...list} />
      </section>

      <section
        className={cx(ui.panel, ui.sectionBlock)}
        aria-labelledby="create-heading"
      >
        <div className={ui.sectionTitle}>
          <h2 id="create-heading">회차 만들기</h2>
          <CourseSearchForm />
          <span>같은 회차가 이미 있으면 그 회차를 씁니다</span>
        </div>
        <Form method="post" className={s.list} preventScrollReset>
          <input type="hidden" name="redirectTo" value={here} />
          <input type="hidden" name="intent" value="create" />
          <CoursePicker serverResults={courseResults} />
          <SittingFields
            kinds={kinds}
            semesters={semesters}
            defaults={{
              kindId: kinds[0]?.id ?? null,
              number: null,
              year: currentYear,
              semester: 1,
            }}
            kindLabel="시험"
          />
          <div className={s.inline}>
            <label>
              <span>
                <input type="checkbox" name="openNow" /> 바로 투표 열기
              </span>
            </label>
            <label>
              마감(서울 시간, 비우면 마감 없음)
              <input name="closesAt" type="datetime-local" />
            </label>
            <button className={cx(ui.button, ui.primary)} type="submit">
              만들기
            </button>
          </div>
        </Form>
      </section>
    </>
  );
}

function SittingCard({
  sitting,
  here,
  semesters,
}: {
  sitting: Sitting;
  here: string;
  semesters: { value: number; label: string }[];
}) {
  const { voting, difficulty } = sitting;
  const hidden = (
    <>
      <input type="hidden" name="redirectTo" value={here} />
      <input type="hidden" name="sittingId" value={sitting.id} />
    </>
  );

  return (
    <article className={s.item}>
      <header>
        <div>
          <h3>
            <Link to={`/courses/${sitting.course.id}?sitting=${sitting.id}`}>
              {sitting.course.title}
            </Link>{" "}
            · {sitting.label}
          </h3>
          <p>
            {sitting.course.instructor} · {termLabel(sitting.term, semesters)} ·{" "}
            {votingText(voting)}
          </p>
          <p>
            난이도 {difficulty.average ?? "-"} ({difficulty.voteCount}표) · 통계{" "}
            {sitting.statisticCount}건 · 요청 {sitting.openRequestCount}건
          </p>
        </div>
      </header>

      {voting.isOpen ? (
        <div className={s.inline}>
          <Form method="post" className={s.inline} preventScrollReset>
            {hidden}
            <label>
              마감(서울 시간, 비우면 마감 없음)
              <input
                name="closesAt"
                type="datetime-local"
                defaultValue={toSeoulInput(voting.closesAt)}
              />
            </label>
            <button
              className={cx(ui.button, ui.subtle)}
              type="submit"
              name="intent"
              value="deadline"
            >
              마감 변경
            </button>
          </Form>
          <Form method="post" preventScrollReset>
            {hidden}
            <button
              className={cx(ui.button, ui.danger)}
              type="submit"
              name="intent"
              value="close"
            >
              지금 종료
            </button>
          </Form>
        </div>
      ) : (
        <Form method="post" className={s.inline} preventScrollReset>
          {hidden}
          <label>
            마감(서울 시간, 비우면 마감 없음)
            <input name="closesAt" type="datetime-local" />
          </label>
          <button
            className={cx(ui.button, ui.primary)}
            type="submit"
            name="intent"
            value="open"
          >
            {voting.state === "closed" ? "다시 열기" : "투표 열기"}
          </button>
        </Form>
      )}
    </article>
  );
}
