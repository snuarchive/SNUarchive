import { Form, Link, redirect, useLocation } from "react-router";

import { apiContext, failureOf } from "~/api/client.server";
import s from "~/components/admin/admin.module.css";
import { UserCard } from "~/components/admin/UserCard";
import { cx } from "~/lib/cx";
import { errorMessage } from "~/lib/errors";
import { flashContext } from "~/lib/flash.server";
import ui from "~/styles/ui.module.css";
import type { Route } from "./+types/lookup";

// Exact-email lookup (the API has no listing), or ?id= when following a
// log entry or contribution to its account.
export async function loader({ request, context }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams;
  const email = (params.get("email") ?? "").trim();
  const id = Number(params.get("id"));
  const client = context.get(apiContext).client;

  if (Number.isInteger(id) && id > 0) {
    const result = await client.GET("/admin/users/{userId}", {
      params: { path: { userId: id } },
    });
    return { email, user: result.data ?? null, searched: true };
  }
  if (!email) return { email, user: null, searched: false };
  const result = await client.GET("/admin/users", {
    params: { query: { email } },
  });
  return { email, user: result.data ?? null, searched: true };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const userId = Number(form.get("userId"));
  const flash = context.get(flashContext);
  const failure = failureOf(
    await context
      .get(apiContext)
      .client.POST("/admin/admins", { body: { userId } }),
  );
  if (failure) flash.put(errorMessage(failure.error), "error");
  else flash.put("관리자로 지정했습니다.");
  return redirect(`/admin/users/lookup?id=${userId}`);
}

export default function Lookup({ loaderData }: Route.ComponentProps) {
  const { email, user, searched } = loaderData;
  const location = useLocation();

  return (
    <section
      className={cx(ui.panel, ui.sectionBlock)}
      aria-labelledby="lookup-heading"
    >
      <div className={ui.sectionTitle}>
        <h2 id="lookup-heading">계정 조회</h2>
        <span>정확한 이메일로만 찾을 수 있습니다</span>
      </div>
      <Form method="get" className={s.inline}>
        <label>
          이메일
          <input
            name="email"
            type="email"
            required
            defaultValue={email}
            autoComplete="off"
          />
        </label>
        <button className={cx(ui.button, ui.subtle)} type="submit">
          찾기
        </button>
      </Form>
      {searched &&
        (user ? (
          <UserCard user={user}>
            <div className={s.actions}>
              <Link
                className={cx(ui.button, ui.subtle)}
                to={`/admin/logs/entries?userId=${user.id}`}
              >
                이 사용자의 로그
              </Link>
              {!user.isAdmin && !user.deletedAt && (
                <Form method="post" action={location.pathname}>
                  <input type="hidden" name="userId" value={user.id} />
                  <button className={cx(ui.button, ui.primary)} type="submit">
                    관리자로 지정
                  </button>
                </Form>
              )}
              {(user.adminSource === "db" || user.adminSource === "both") && (
                <Link
                  className={cx(ui.button, ui.danger)}
                  to={`/admin/users/admins/${user.id}/revoke`}
                >
                  관리자 회수
                </Link>
              )}
            </div>
          </UserCard>
        ) : (
          <div className={ui.emptySmall}>계정을 찾지 못했습니다.</div>
        ))}
    </section>
  );
}
