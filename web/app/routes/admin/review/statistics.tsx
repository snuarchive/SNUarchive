import { Form, useLocation } from "react-router";

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
import { FIGURE_NAMES, readNickname } from "~/lib/figures";
import { flashContext } from "~/lib/flash.server";
import { formatDate, termLabel } from "~/lib/format";
import { blockNumberKeys } from "~/lib/forms";
import { back } from "~/lib/redirect.server";
import { readSittingKey } from "~/lib/sittings";
import { getConfig } from "~/lib/viewer.server";
import { usePagedList } from "~/lib/usePagedList";
import ui from "~/styles/ui.module.css";
import type { Route } from "./+types/statistics";

const PAGE_SIZE = 10;

export async function loader({ request, context }: Route.LoaderArgs) {
  const [page, options] = await Promise.all([
    load(
      context.get(apiContext).client.GET("/admin/statistics", {
        params: { query: { limit: PAGE_SIZE, cursor: cursorOf(request) } },
      }),
    ),
    sittingOptions(context),
  ]);
  return {
    page,
    ...options,
    courseResults: await courseSearch(request, context),
  };
}

/** Figures for PATCH: every field is sent, an empty one clearing it. */
function patchFigures(form: FormData) {
  const body: Record<string, number | string | null> = {};
  for (const name of FIGURE_NAMES) {
    const text = String(form.get(name) ?? "").trim();
    body[name] = text ? Number(text) : null;
  }
  body.note = String(form.get("note") ?? "").trim() || null;
  return body;
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const client = context.get(apiContext).client;
  const flash = context.get(flashContext);
  const path = { statisticId: Number(form.get("statisticId")) };
  const intent = form.get("intent");
  let result;
  let success: string;

  if (intent === "save") {
    const figures = patchFigures(form);
    if (
      Object.values(figures).some(
        (v) => typeof v === "number" && !Number.isFinite(v),
      )
    ) {
      flash.put("숫자를 확인해주세요.", "error");
      return back(form, "/admin/review/statistics");
    }
    result = await client.PATCH("/admin/statistics/{statisticId}", {
      params: { path },
      body: { ...figures, nickname: readNickname(form) },
    });
    success = "통계량을 수정했습니다.";
  } else if (intent === "hide" || intent === "unhide") {
    const reason = String(form.get("reason") ?? "").trim() || null;
    result = await client.PUT("/admin/statistics/{statisticId}/hidden", {
      params: { path },
      body: {
        hidden: intent === "hide",
        reason: intent === "hide" ? reason : null,
      },
    });
    success =
      intent === "hide" ? "통계량을 숨겼습니다." : "통계량을 복구했습니다.";
  } else if (intent === "move") {
    const config = await getConfig(context);
    const key = readSittingKey(form, config.assessmentKinds);
    const courseId = Number(form.get("courseId"));
    if (!key || !Number.isInteger(courseId) || courseId < 1) {
      flash.put("옮길 강의와 시험 정보를 확인해주세요.", "error");
      return back(form, "/admin/review/statistics");
    }
    result = await client.POST("/admin/statistics/{statisticId}/move", {
      params: { path },
      body: { courseId, ...key },
    });
    success = "통계량을 옮겼습니다.";
  } else {
    return back(form, "/admin/review/statistics");
  }

  const failure = failureOf(result);
  if (failure) flash.put(errorMessage(failure.error), "error");
  else flash.put(success);
  return back(form, "/admin/review/statistics");
}

type Stat = Schemas["AdminStatistic"];

export default function Statistics({ loaderData }: Route.ComponentProps) {
  const { page, kinds, semesters, courseResults } = loaderData;
  const location = useLocation();
  const list = usePagedList(
    page,
    pageEndpoint(location.pathname, location.search),
    (data: typeof loaderData) => data.page,
  );
  const here = location.pathname + location.search;

  return (
    <section
      className={cx(ui.panel, ui.sectionBlock)}
      aria-labelledby="stats-heading"
    >
      <div className={ui.sectionTitle}>
        <h2 id="stats-heading">최근 통계량</h2>
        <CourseSearchForm />
        <span>
          {list.items.length}건{list.cursor ? "+" : ""}
        </span>
      </div>
      <div className={s.list}>
        {list.items.length === 0 ? (
          <div className={ui.emptySmall}>통계량이 없습니다.</div>
        ) : (
          list.items.map((stat) => (
            <StatCard
              key={stat.id}
              stat={stat}
              here={here}
              {...{ kinds, semesters, courseResults }}
            />
          ))
        )}
      </div>
      <MoreLink {...list} />
    </section>
  );
}

const FIGURE_LABELS: Record<(typeof FIGURE_NAMES)[number], string> = {
  q1: "Q1",
  q2: "Q2",
  q3: "Q3",
  q4: "Q4",
  average: "평균",
  maxScore: "만점",
};

function StatCard({
  stat,
  here,
  kinds,
  semesters,
  courseResults,
}: {
  stat: Stat;
  here: string;
  kinds: Schemas["AssessmentKind"][];
  semesters: { value: number; label: string }[];
  courseResults: Schemas["CourseSummary"][];
}) {
  const hidden = stat.hiddenAt !== null;
  return (
    <article className={cx(s.item, hidden && s.hidden)}>
      <header>
        <div>
          <h3>{stat.course.title}</h3>
          <p>
            {stat.course.instructor} · {stat.sitting.label} ·{" "}
            {termLabel(stat.sitting.term, semesters)} ·{" "}
            {formatDate(stat.createdAt)}
          </p>
          <p>
            {stat.source === "transcribed" ? "간편 제보 승인" : "직접 제보"} ·
            기여자{" "}
            {stat.contributor.deleted
              ? "(탈퇴한 사용자)"
              : (stat.contributor.displayName ?? `#${stat.contributor.id}`)}
            {hidden &&
              ` · 숨김 ${formatDate(stat.hiddenAt)}${stat.hiddenReason ? ` (${stat.hiddenReason})` : ""}`}
          </p>
        </div>
      </header>

      <Form method="post" className={s.list} preventScrollReset>
        <input type="hidden" name="redirectTo" value={here} />
        <input type="hidden" name="statisticId" value={stat.id} />
        <div className={s.editGrid}>
          <label>
            닉네임
            <input
              name="nickname"
              maxLength={10}
              defaultValue={stat.nickname}
            />
          </label>
          {FIGURE_NAMES.map((name) => (
            <label key={name}>
              {FIGURE_LABELS[name]}
              <input
                name={name}
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                onKeyDown={blockNumberKeys}
                defaultValue={stat[name] ?? ""}
              />
            </label>
          ))}
        </div>
        <label>
          비고
          <textarea
            name="note"
            rows={2}
            maxLength={500}
            defaultValue={stat.note ?? ""}
          />
        </label>
        <div className={s.actions}>
          <button
            className={cx(ui.button, ui.primary)}
            type="submit"
            name="intent"
            value="save"
          >
            수정 저장
          </button>
        </div>
      </Form>

      <Form method="post" className={s.inline} preventScrollReset>
        <input type="hidden" name="redirectTo" value={here} />
        <input type="hidden" name="statisticId" value={stat.id} />
        {hidden ? (
          <button
            className={cx(ui.button, ui.subtle)}
            type="submit"
            name="intent"
            value="unhide"
          >
            복구
          </button>
        ) : (
          <>
            <label>
              숨김 사유
              <input
                name="reason"
                maxLength={500}
                placeholder="예: 중복, 테스트"
              />
            </label>
            <button
              className={cx(ui.button, ui.danger)}
              type="submit"
              name="intent"
              value="hide"
            >
              숨기기
            </button>
          </>
        )}
      </Form>

      <details>
        <summary className={ui.muted}>다른 강의·시험으로 옮기기</summary>
        <Form method="post" className={s.list} preventScrollReset>
          <input type="hidden" name="redirectTo" value={here} />
          <input type="hidden" name="statisticId" value={stat.id} />
          <CoursePicker current={stat.course} serverResults={courseResults} />
          <SittingFields
            kinds={kinds}
            semesters={semesters}
            defaults={{
              kindId: stat.sitting.kindId,
              number: stat.sitting.number,
              year: stat.sitting.term.year,
              semester: stat.sitting.term.semester,
            }}
            kindLabel="시험"
          />
          <div className={s.actions}>
            <button
              className={cx(ui.button, ui.subtle)}
              type="submit"
              name="intent"
              value="move"
            >
              옮기기
            </button>
          </div>
        </Form>
      </details>
    </article>
  );
}
