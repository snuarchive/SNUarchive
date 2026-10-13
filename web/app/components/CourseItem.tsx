import { Link, useFetcher, useLocation } from "react-router";

import type { Schemas } from "~/api/types";
import { cx } from "~/lib/cx";
import { departmentsText, formatDate } from "~/lib/format";
import s from "./CourseItem.module.css";

type Props = {
  course: Schemas["CourseSummary"];
  favorite: boolean;
  active: boolean;
  /** The search to keep in the course link. */
  q: string;
  /** Extra badge text, e.g. the request count on the home list. */
  extraBadge?: string;
};

export function CourseItem({ course, favorite, active, q, extraBadge }: Props) {
  const location = useLocation();
  const fetcher = useFetcher();
  // Show the toggled star before the server answers.
  const pending = fetcher.formData?.get("favorite");
  const starred =
    pending === undefined || pending === null ? favorite : pending === "on";

  const badges = [
    starred && "즐겨찾기",
    course.votingOpen && "투표중",
    course.latestStatisticAt &&
      `최근 제보 ${formatDate(course.latestStatisticAt)}`,
    extraBadge,
  ].filter((badge): badge is string => Boolean(badge));

  const to = `/courses/${course.id}${q ? `?q=${encodeURIComponent(q)}` : ""}`;

  return (
    <article className={cx(s.item, active && s.active)}>
      <Link
        className={s.main}
        to={to}
        aria-current={active ? "page" : undefined}
      >
        <span className={s.titleLine}>
          <strong>{course.title}</strong>
        </span>
        <span className={s.meta}>
          {course.instructor} ·{" "}
          {departmentsText(course.departments, course.departmentCount)}
        </span>
        {badges.length > 0 && (
          <span className={s.badges}>
            {badges.map((badge) => (
              <em key={badge}>{badge}</em>
            ))}
          </span>
        )}
      </Link>
      <fetcher.Form
        method="post"
        action={`/courses/${course.id}/favorite`}
        preventScrollReset
        className={s.favoriteForm}
      >
        <input
          type="hidden"
          name="redirectTo"
          value={location.pathname + location.search}
        />
        <input type="hidden" name="favorite" value={starred ? "off" : "on"} />
        <button
          className={s.favorite}
          type="submit"
          aria-pressed={starred}
          title="즐겨찾기"
          aria-label={starred ? "즐겨찾기 해제" : "즐겨찾기"}
        >
          {starred ? "★" : "☆"}
        </button>
      </fetcher.Form>
    </article>
  );
}
