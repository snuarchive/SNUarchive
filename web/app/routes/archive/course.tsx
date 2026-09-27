import { data, Form, Link, redirect, useLocation } from "react-router";

import { apiContext, failureOf, load } from "~/api/client.server";
import { ReportReviewCard } from "~/components/admin/ReportReviewCard";
import { CommentsSection } from "~/components/course/CommentsSection";
import { PollSection } from "~/components/course/PollSection";
import { DirectReport, QuickReport } from "~/components/course/ReportForms";
import s from "~/components/course/ReportForms.module.css";
import { StatsSection } from "~/components/course/StatsSection";
import { refuse, refuseFromApi } from "~/lib/actions.server";
import { lastCourseCookie } from "~/lib/cookies.server";
import { cx } from "~/lib/cx";
import { formValues, readFigures, readNickname } from "~/lib/figures";
import { flashContext } from "~/lib/flash.server";
import { departmentsText } from "~/lib/format";
import {
  defaultKindCode,
  pickDefaultSitting,
  readSittingKey,
  termYears,
} from "~/lib/sittings";
import { seoulParts } from "~/lib/time.server";
import { getConfig, requireMe } from "~/lib/viewer.server";
import ui from "~/styles/ui.module.css";
import type { Route } from "./+types/course";
import page from "./course.module.css";

function courseIdOf(params: { courseId?: string }): number {
  const id = Number(params.courseId);
  if (!Number.isInteger(id) || id < 1) throw data(null, { status: 404 });
  return id;
}

// Remember the course so a fresh visit to / reopens it.
export const middleware: Route.MiddlewareFunction[] = [
  async ({ request, params }, next) => {
    const response = await next();
    if (request.method === "GET" && response.status === 200) {
      response.headers.append(
        "Set-Cookie",
        await lastCourseCookie.serialize(courseIdOf(params)),
      );
    }
    return response;
  },
];

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const me = await requireMe(context);
  const courseId = courseIdOf(params);
  const url = new URL(request.url);
  const client = context.get(apiContext).client;
  const path = { courseId };
  const commentsCursor = url.searchParams.get("comments");

  const [course, config, pendingReports, commentsPage] = await Promise.all([
    load(client.GET("/courses/{courseId}", { params: { path } })),
    getConfig(context),
    me.isAdmin
      ? load(
          client.GET("/admin/reports", {
            params: { query: { courseId, status: "pending" } },
          }),
        )
      : null,
    // Without JavaScript, "더 보기" on comments reloads the page with this.
    commentsCursor
      ? load(
          client.GET("/courses/{courseId}/comments", {
            params: { path, query: { cursor: commentsCursor } },
          }),
        )
      : null,
  ]);

  const today = seoulParts(new Date());
  const currentTerm = me.calendar.currentTerm;
  const defaultKindId =
    config.assessmentKinds.find(
      (k) => k.code === defaultKindCode(today.month, today.day),
    )?.id ?? null;
  const requested = course.sittings.find(
    (s) => s.id === Number(url.searchParams.get("sitting")),
  );
  const selected =
    requested ??
    pickDefaultSitting(course.sittings, currentTerm, defaultKindId);

  return {
    course: commentsPage ? { ...course, comments: commentsPage } : course,
    selectedSittingId: selected?.id ?? null,
    kinds: config.assessmentKinds,
    semesters: config.semesters,
    upload: config.upload,
    commentMaxLength: config.comment.maxLength,
    noteMaxLength: config.votingRequest.noteMaxLength,
    years: termYears(currentTerm, course.offerings),
    sittingDefaults: {
      kindId: defaultKindId,
      number: null,
      year: currentTerm.year,
      semester: currentTerm.semester,
    },
    q: url.searchParams.get("q") ?? "",
    pendingReports: pendingReports?.items ?? null,
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  await requireMe(context);
  const courseId = courseIdOf(params);
  const client = context.get(apiContext).client;
  const flash = context.get(flashContext);
  const here = new URL(request.url);
  const done = (message: string) => {
    flash.put(message);
    return redirect(here.pathname + here.search);
  };

  const form = await request.formData();
  const intent = String(form.get("intent"));
  const values = formValues(form);
  const path = { courseId };

  switch (intent) {
    case "statistic": {
      const config = await getConfig(context);
      const key = readSittingKey(form, config.assessmentKinds);
      if (!key)
        return refuse(intent, "시험 형태와 번호, 학기를 확인해주세요.", values);
      const { figures, invalid } = readFigures(form);
      if (invalid.length) {
        return refuse(
          intent,
          "숫자를 확인해주세요.",
          values,
          Object.fromEntries(
            invalid.map((name) => [name, "0 이상의 숫자를 입력해주세요."]),
          ),
        );
      }
      if (Object.keys(figures).length === 0) {
        return refuse(intent, "수치나 비고를 하나 이상 입력해주세요.", values);
      }
      const failure = failureOf(
        await client.POST("/courses/{courseId}/statistics", {
          params: { path },
          body: { ...key, ...figures, nickname: readNickname(form) },
        }),
      );
      return failure
        ? refuseFromApi(intent, failure, values)
        : done("통계량을 등록했습니다.");
    }

    case "upload": {
      const config = await getConfig(context);
      const key = readSittingKey(form, config.assessmentKinds);
      const file = form.get("file");
      if (!key)
        return refuse(intent, "시험 형태와 번호, 학기를 확인해주세요.", values);
      if (!(file instanceof File) || file.size === 0) {
        return refuse(intent, "파일을 선택해주세요.", values);
      }
      const limitMb = Math.round(config.upload.maxBytes / 1024 / 1024);
      if (file.size > config.upload.maxBytes) {
        return refuse(intent, `파일은 ${limitMb}MB 이하만 가능합니다.`, values);
      }
      const body = new FormData();
      body.set("file", file, file.name);
      body.set("kindId", String(key.kindId));
      if (key.number !== null) body.set("number", String(key.number));
      body.set("year", String(key.year));
      body.set("semester", String(key.semester));
      const nickname = readNickname(form);
      if (nickname) body.set("nickname", nickname);
      const failure = failureOf(
        await client.POST("/courses/{courseId}/reports", {
          params: { path },
          // The generated body type describes the fields; send them as the
          // multipart FormData built above.
          body: body as unknown as never,
          bodySerializer: (b: unknown) => b as FormData,
        }),
      );
      return failure
        ? refuseFromApi(intent, failure, values)
        : done("간편 제보를 접수했습니다.");
    }

    case "comment": {
      const text = String(form.get("body") ?? "").trim();
      if (!text) return refuse(intent, "후기를 입력해주세요.", values);
      const failure = failureOf(
        await client.POST("/courses/{courseId}/comments", {
          params: { path },
          body: { body: text },
        }),
      );
      return failure
        ? refuseFromApi(intent, failure, values)
        : done("후기를 등록했습니다.");
    }

    case "vote": {
      const rating = Number(form.get("rating"));
      const sittingId = Number(form.get("sittingId"));
      if (!(rating >= 1 && rating <= 5))
        return refuse(intent, "난이도를 선택해주세요.", values);
      const failure = failureOf(
        await client.PUT("/sittings/{sittingId}/vote", {
          params: { path: { sittingId } },
          body: { rating: rating as 1 | 2 | 3 | 4 | 5 },
        }),
      );
      if (failure) return refuseFromApi(intent, failure, values);
      here.searchParams.set("sitting", String(sittingId));
      return done("투표했습니다.");
    }

    case "request": {
      const config = await getConfig(context);
      const key = readSittingKey(form, config.assessmentKinds);
      if (!key)
        return refuse(intent, "투표 대상과 번호, 학기를 확인해주세요.", values);
      const note = String(form.get("note") ?? "").trim();
      const result = await client.POST("/courses/{courseId}/voting-requests", {
        params: { path },
        body: { ...key, note: note || null },
      });
      const failure = failureOf(result);
      if (failure) return refuseFromApi(intent, failure, values);
      if (result.data)
        here.searchParams.set("sitting", String(result.data.sitting.id));
      return done("투표를 요청했습니다.");
    }

    case "cancel-request": {
      const requestId = Number(form.get("requestId"));
      const failure = failureOf(
        await client.DELETE("/voting-requests/{requestId}", {
          params: { path: { requestId } },
        }),
      );
      return failure
        ? refuseFromApi(intent, failure, values)
        : done("투표 요청을 취소했습니다.");
    }
  }
  throw data(null, { status: 400 });
}

export function meta({ loaderData }: Route.MetaArgs): Route.MetaDescriptors {
  return [
    {
      title: loaderData
        ? `${loaderData.course.title} · SNU Archive`
        : "SNU Archive",
    },
  ];
}

export default function Course({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const {
    course,
    kinds,
    semesters,
    years,
    sittingDefaults,
    q,
    pendingReports,
  } = loaderData;
  const location = useLocation();
  const selected =
    course.sittings.find((s) => s.id === loaderData.selectedSittingId) ?? null;
  const pollActive = course.sittings.some((s) => s.voting.isOpen);
  const pollErrors =
    actionData?.intent === "request" ? actionData.fields : undefined;

  const poll = (
    <PollSection
      key="poll"
      sittings={course.sittings}
      selected={selected}
      requestDefaults={sittingDefaults}
      kinds={kinds}
      semesters={semesters}
      years={years}
      noteMaxLength={loaderData.noteMaxLength}
      q={q}
      errors={pollErrors}
    />
  );
  const stats = (
    <StatsSection
      key="stats"
      sittings={course.sittings}
      semesters={semesters}
    />
  );
  const reports = (
    <section key="reports" className={s.grid} aria-label="제보">
      <DirectReport
        courseId={course.id}
        kinds={kinds}
        semesters={semesters}
        years={years}
        defaults={sittingDefaults}
      />
      <QuickReport
        courseId={course.id}
        kinds={kinds}
        semesters={semesters}
        years={years}
        defaults={sittingDefaults}
        upload={loaderData.upload}
      />
    </section>
  );

  // Legacy order: an open vote moves the voting section to the top.
  const sections = pollActive ? [poll, stats, reports] : [stats, reports, poll];

  return (
    <article className={page.detail}>
      <header className={cx(ui.panel, page.header)}>
        <div>
          <p>
            {course.instructor} ·{" "}
            {departmentsText(
              course.departments.slice(0, 2),
              course.departments.length,
            )}
          </p>
          <h1>{course.title}</h1>
        </div>
        <div className={page.actions}>
          <Form
            method="post"
            action={`/courses/${course.id}/favorite`}
            preventScrollReset
          >
            <input
              type="hidden"
              name="redirectTo"
              value={location.pathname + location.search}
            />
            <input
              type="hidden"
              name="favorite"
              value={course.isFavorite ? "off" : "on"}
            />
            <button
              className={cx(ui.button, ui.iconButton, page.favorite)}
              type="submit"
              aria-pressed={course.isFavorite}
              title="즐겨찾기"
            >
              {course.isFavorite ? "★" : "☆"}
            </button>
          </Form>
          <Link
            className={cx(ui.button, ui.iconButton)}
            to={location.pathname + location.search}
            preventScrollReset
            title="새로고침"
          >
            ↻
          </Link>
        </div>
      </header>

      {sections}

      <CommentsSection
        courseId={course.id}
        comments={course.comments}
        maxLength={loaderData.commentMaxLength}
      />

      {pendingReports && (
        <section
          className={cx(ui.panel, ui.sectionBlock)}
          aria-labelledby="course-admin-heading"
        >
          <div className={ui.sectionTitle}>
            <h2 id="course-admin-heading">이 과목 제보 큐</h2>
            <Link
              className={cx(ui.button, ui.subtle)}
              to={location.pathname + location.search}
              preventScrollReset
            >
              불러오기
            </Link>
          </div>
          <div className={page.adminList}>
            {pendingReports.length === 0 ? (
              <div className={ui.emptySmall}>제보가 없습니다.</div>
            ) : (
              pendingReports.map((report) => (
                <ReportReviewCard
                  key={report.id}
                  report={report}
                  kinds={kinds}
                  semesters={semesters}
                  years={years}
                />
              ))
            )}
          </div>
        </section>
      )}
    </article>
  );
}
