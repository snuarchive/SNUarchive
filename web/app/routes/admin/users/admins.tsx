import { Form, Link } from "react-router";

import { apiContext, load } from "~/api/client.server";
import s from "~/components/admin/admin.module.css";
import { adminSourceLabel } from "~/components/admin/UserCard";
import { cx } from "~/lib/cx";
import { formatDateTime } from "~/lib/format";
import ui from "~/styles/ui.module.css";
import type { Route } from "./+types/admins";

export async function loader({ context }: Route.LoaderArgs) {
  return load(context.get(apiContext).client.GET("/admin/admins"));
}

export default function Admins({ loaderData }: Route.ComponentProps) {
  const { items } = loaderData;
  return (
    <section
      className={cx(ui.panel, ui.sectionBlock)}
      aria-labelledby="admins-heading"
    >
      <div className={ui.sectionTitle}>
        <h2 id="admins-heading">관리자</h2>
        <span>{items.length}명</span>
      </div>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>이메일</th>
              <th>지정 방식</th>
              <th>최근 접속</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((entry) => (
              <tr key={entry.email}>
                <td>
                  {entry.user ? (
                    <Link to={`/admin/users/lookup?id=${entry.user.id}`}>
                      {entry.email}
                    </Link>
                  ) : (
                    entry.email
                  )}
                </td>
                <td>{adminSourceLabel(entry.source)}</td>
                <td>
                  {entry.user
                    ? formatDateTime(entry.user.lastSeenAt)
                    : "로그인한 적 없음"}
                </td>
                <td>
                  {entry.user && entry.source !== "env" ? (
                    <Link
                      className={cx(ui.button, ui.danger)}
                      to={`/admin/users/admins/${entry.user.id}/revoke`}
                    >
                      회수
                    </Link>
                  ) : entry.source === "env" ? (
                    <span className={ui.muted}>환경변수에서 변경</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Form method="get" action="/admin/users/lookup" className={s.inline}>
        <label>
          관리자 추가: 이메일로 계정 찾기
          <input name="email" type="email" required autoComplete="off" />
        </label>
        <button className={cx(ui.button, ui.subtle)} type="submit">
          찾기
        </button>
      </Form>
    </section>
  );
}
