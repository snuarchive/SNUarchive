import type { Route } from "./+types/course";

export default function Course({ params }: Route.ComponentProps) {
  return (
    <article data-course-id={params.courseId}>
      <header>
        <p />
        <h1 />
      </header>

      <section aria-labelledby="poll-heading">
        <h2 id="poll-heading">난이도 투표</h2>
      </section>

      <section aria-labelledby="stats-heading">
        <h2 id="stats-heading">통계량</h2>
      </section>

      <section aria-label="제보" />

      <section aria-labelledby="comments-heading">
        <h2 id="comments-heading">한줄 후기</h2>
      </section>
    </article>
  );
}
