import { data, Form, Link, redirect } from "react-router";

import { apiContext, failureOf, load } from "~/api/client.server";
import s from "~/components/admin/admin.module.css";
import { UserCard } from "~/components/admin/UserCard";
import { cx } from "~/lib/cx";
import { errorMessage } from "~/lib/errors";
import { flashContext } from "~/lib/flash.server";
import { requireAdmin } from "~/lib/viewer.server";
import ui from "~/styles/ui.module.css";
import type { Route } from "./+types/revoke";

function userIdOf(params: { userId?: string }): number {
  const id = Number(params.userId);
  if (!Number.isInteger(id) || id < 1) throw data(null, { status: 404 });
  return id;
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const me = await requireAdmin(context);
  const userId = userIdOf(params);
  const user = await load(
    context.get(apiContext).client.GET("/admin/users/{userId}", {
      params: { path: { userId } },
    }),
  );
  return { user, self: user.id === me.id };
}

export async function action({ params, context }: Route.ActionArgs) {
  const me = await requireAdmin(context);
  const userId = userIdOf(params);
  const failure = failureOf(
    await context.get(apiContext).client.DELETE("/admin/admins/{userId}", {
      params: { path: { userId } },
    }),
  );
  const flash = context.get(flashContext);
  if (failure) {
    flash.put(errorMessage(failure.error), "error");
    return redirect("/admin/users/admins");
  }
  flash.put("관리자 권한을 회수했습니다.");
  // Revoking yourself ends your access to the console.
  return redirect(userId === me.id ? "/" : "/admin/users/admins");
}

export default function Revoke({ loaderData }: Route.ComponentProps) {
  const { user, self } = loaderData;
  return (
    <section
      className={cx(ui.panel, ui.sectionBlock)}
      aria-labelledby="revoke-heading"
    >
      <div className={ui.sectionTitle}>
        <h2 id="revoke-heading">관리자 회수</h2>
      </div>
      <UserCard user={user} />
      <p>
        이 계정의 관리자 권한을 회수하고 그 계정의 모든 기기에서
        로그아웃시킵니다.
      </p>
      {self && (
        <p className={ui.fieldError}>
          본인의 권한입니다. 회수하면 바로 관리자 화면을 쓸 수 없게 됩니다.
        </p>
      )}
      <Form method="post" className={s.actions}>
        <button className={cx(ui.button, ui.danger)} type="submit">
          회수
        </button>
        <Link className={cx(ui.button, ui.subtle)} to="/admin/users/admins">
          취소
        </Link>
      </Form>
    </section>
  );
}
