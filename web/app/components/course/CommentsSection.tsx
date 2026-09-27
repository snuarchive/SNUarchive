import { useRef, useState } from "react";
import { Form, Link, useLocation } from "react-router";

import type { Schemas } from "~/api/types";
import { cx } from "~/lib/cx";
import { codePointLength, formatDate } from "~/lib/format";
import { useFailure, useResetOnSuccess } from "~/lib/forms";
import { useHydrated } from "~/lib/hydrated";
import { usePagedList } from "~/lib/usePagedList";
import ui from "~/styles/ui.module.css";
import s from "./CommentsSection.module.css";

type Page = Schemas["CommentPage"];

type Props = {
  courseId: number;
  comments: Page;
  maxLength: number;
  className?: string;
};

export function CommentsSection({
  courseId,
  comments,
  maxLength,
  className,
}: Props) {
  const form = useRef<HTMLFormElement>(null);
  const failure = useFailure("comment");
  const hydrated = useHydrated();
  const [length, setLength] = useState(0);
  useResetOnSuccess(form, "comment");

  // Legacy rule: counted in code points, submit disabled when empty or over
  // the limit. Without JavaScript the server enforces it.
  const blocked = hydrated && (length === 0 || length > maxLength);

  return (
    <section
      className={cx(ui.panel, ui.sectionBlock, className)}
      aria-labelledby="comments-heading"
    >
      <div className={ui.sectionTitle}>
        <h2 id="comments-heading">한줄 후기</h2>
        <span>
          {comments.items.length}
          {comments.nextCursor ? "+" : ""}건
        </span>
      </div>
      <Form
        ref={form}
        method="post"
        className={s.form}
        preventScrollReset
        onReset={() => setLength(0)}
      >
        <input type="hidden" name="intent" value="comment" />
        <input
          name="body"
          type="text"
          placeholder="이 강의에 대한 한줄 후기 (이름은 가려서 표시돼요)"
          autoComplete="off"
          aria-label="한줄 후기"
          required
          onChange={(event) =>
            setLength(codePointLength(event.currentTarget.value))
          }
        />
        <span className={s.counter}>
          {length}/{maxLength}
        </span>
        <button
          className={cx(ui.button, ui.primary)}
          type="submit"
          disabled={blocked}
        >
          등록
        </button>
      </Form>
      {failure && <p className={ui.fieldError}>{failure.message}</p>}
      <CommentList
        key={comments.items[0]?.id ?? 0}
        courseId={courseId}
        first={comments}
      />
    </section>
  );
}

/** The comments, with later pages appended through a fetcher. */
function CommentList({ courseId, first }: { courseId: number; first: Page }) {
  const location = useLocation();
  const { items, cursor, loading, loadMore } = usePagedList(
    first,
    (c) => `/courses/${courseId}/comments?cursor=${encodeURIComponent(c)}`,
  );
  // Without JavaScript: the course page showing the next page of comments.
  const pageHref = (c: string) => {
    const params = new URLSearchParams(location.search);
    params.set("comments", c);
    return `?${params}`;
  };

  return (
    <>
      <div className={s.list}>
        {items.length === 0 ? (
          <div className={ui.emptySmall}>등록된 후기가 없습니다.</div>
        ) : (
          items.map((comment) => (
            <article className={s.item} key={comment.id}>
              <span className={s.name}>
                {comment.author ?? "(탈퇴한 사용자)"}
              </span>
              <span className={s.body}>{comment.body}</span>
              <time dateTime={comment.createdAt}>
                {formatDate(comment.createdAt)}
              </time>
            </article>
          ))
        )}
      </div>
      {cursor && (
        <Link
          className={cx(ui.button, ui.subtle, ui.more)}
          to={pageHref(cursor)}
          preventScrollReset
          onClick={(event) => {
            event.preventDefault();
            loadMore();
          }}
        >
          {loading ? "불러오는 중…" : "더 보기"}
        </Link>
      )}
    </>
  );
}
