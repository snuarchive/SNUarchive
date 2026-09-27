import { useState } from "react";
import { Link, useFetcher } from "react-router";

import type { Schemas } from "~/api/types";
import { cx } from "~/lib/cx";
import { departmentsText } from "~/lib/format";
import { moveBy, moveTo, parseIds } from "~/lib/order";
import ui from "~/styles/ui.module.css";
import s from "./FavoriteOrder.module.css";

type Course = Schemas["CourseSummary"];

/**
 * Every favourite in the viewer's order. The ↑↓ buttons are forms that post
 * the whole new order, so they work without JavaScript; with it, rows can
 * also be dragged. The shown order follows a pending submission at once.
 */
export function FavoriteOrder({ items }: { items: Course[] }) {
  const fetcher = useFetcher();
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const saved = items.map((course) => course.id);
  const pending = fetcher.formData?.get("ids");
  const order = (pending ? parseIds(String(pending)) : null) ?? saved;
  const byId = new Map(items.map((course) => [course.id, course]));
  const courses = order.flatMap((id) => byId.get(id) ?? []);

  const submit = (ids: number[]) =>
    fetcher.submit(
      { intent: "reorder", ids: ids.join(",") },
      { method: "post", action: "/me", preventScrollReset: true },
    );

  if (courses.length === 0) {
    return <div className={ui.emptySmall}>즐겨찾기한 강의가 없습니다.</div>;
  }

  return (
    <ol className={s.list}>
      {courses.map((course, index) => (
        <li
          key={course.id}
          className={cx(
            s.item,
            dragFrom === index && s.dragging,
            dragOver === index && dragFrom !== index && s.over,
          )}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            // Firefox starts a drag only when some data is set.
            event.dataTransfer.setData("text/plain", String(course.id));
            setDragFrom(index);
          }}
          onDragOver={(event) => {
            if (dragFrom === null) return;
            event.preventDefault();
            setDragOver(index);
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (dragFrom !== null && dragFrom !== index) {
              submit(moveTo(order, dragFrom, index));
            }
            setDragFrom(null);
            setDragOver(null);
          }}
          onDragEnd={() => {
            setDragFrom(null);
            setDragOver(null);
          }}
        >
          <span className={s.handle} aria-hidden="true">
            ⠿
          </span>
          <Link to={`/courses/${course.id}`} className={s.course}>
            <strong>{course.title}</strong>
            <span>
              {course.instructor} ·{" "}
              {departmentsText(course.departments, course.departmentCount)}
            </span>
          </Link>
          <div className={s.buttons}>
            {(
              [
                [-1, "↑", "위로"],
                [1, "↓", "아래로"],
              ] as const
            ).map(([delta, arrow, label]) => {
              const next = moveBy(order, course.id, delta);
              return (
                <fetcher.Form
                  key={delta}
                  method="post"
                  action="/me"
                  preventScrollReset
                >
                  <input type="hidden" name="intent" value="reorder" />
                  <input type="hidden" name="ids" value={next.join(",")} />
                  <button
                    className={cx(ui.button, ui.subtle, s.move)}
                    type="submit"
                    disabled={next === order}
                    aria-label={`${course.title} ${label}`}
                  >
                    {arrow}
                  </button>
                </fetcher.Form>
              );
            })}
          </div>
        </li>
      ))}
    </ol>
  );
}
