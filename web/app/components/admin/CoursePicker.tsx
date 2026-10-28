import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";

import type { Schemas } from "~/api/types";
import { cx } from "~/lib/cx";
import ui from "~/styles/ui.module.css";
import s from "./admin.module.css";

type Course = Pick<Schemas["CourseSummary"], "id" | "title" | "instructor">;

/** The id of the page-level GET form the picker's search box submits to. */
export const COURSE_SEARCH_FORM = "course-search";

/**
 * The empty GET form that pickers submit their search to without
 * JavaScript. Render it once per page, outside any other form.
 */
export function CourseSearchForm() {
  return <form id={COURSE_SEARCH_FORM} method="get" hidden />;
}

type Props = {
  /** Preselected course, e.g. the one a statistic is filed under now. */
  current?: Course;
  /** Results the loader found for ?courseQ= (the no-JavaScript path). */
  serverResults?: Course[];
};

const SEARCH_DELAY_MS = 250;

/**
 * Picks a course by searching its title or instructor; submits `courseId`
 * with the surrounding form. With JavaScript the results follow the typing;
 * without, "찾기" reloads the page with ?courseQ= and the loader supplies
 * them.
 */
export function CoursePicker({ current, serverResults = [] }: Props) {
  const fetcher = useFetcher<Schemas["CourseSummaryPage"]>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const found: Course[] = fetcher.data?.items ?? serverResults;
  const options = [
    ...(current ? [current] : []),
    ...found.filter((course) => course.id !== current?.id),
  ];

  return (
    <fieldset className={s.picker}>
      <legend>강의</legend>
      <div className={s.inline}>
        <input
          type="search"
          name="courseQ"
          form={COURSE_SEARCH_FORM}
          placeholder="강의명, 교수명으로 찾기"
          aria-label="강의 찾기"
          autoComplete="off"
          onChange={(event) => {
            const q = event.currentTarget.value.trim();
            clearTimeout(timer.current);
            if (!q) return;
            timer.current = setTimeout(
              () => fetcher.load(`/search?q=${encodeURIComponent(q)}`),
              SEARCH_DELAY_MS,
            );
          }}
          onKeyDown={(event) => {
            // Enter would submit the page-level search form; with JS the
            // results are already live.
            if (event.key === "Enter") event.preventDefault();
          }}
        />
        <button
          className={cx(ui.button, ui.subtle, "no-js-only")}
          type="submit"
          form={COURSE_SEARCH_FORM}
        >
          찾기
        </button>
      </div>
      {options.length === 0 ? (
        <p className={ui.muted}>강의를 찾아 고르세요.</p>
      ) : (
        <div className={s.pickerOptions} role="radiogroup" aria-label="강의">
          {options.map((course, index) => (
            <label key={course.id} className={s.pickerOption}>
              <input
                type="radio"
                name="courseId"
                value={course.id}
                required
                defaultChecked={
                  current ? course.id === current.id : index === 0
                }
              />
              <span>
                {course.title} · {course.instructor}
                <small> #{course.id}</small>
              </span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
