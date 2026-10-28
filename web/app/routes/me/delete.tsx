import { Form, Link, redirect } from "react-router";

import { apiContext } from "~/api/client.server";
import { cx } from "~/lib/cx";
import { flashContext } from "~/lib/flash.server";
import { requireMe } from "~/lib/viewer.server";
import ui from "~/styles/ui.module.css";
import type { Route } from "./+types/delete";
import s from "./me.module.css";

export function meta(): Route.MetaDescriptors {
  return [{ title: "회원 탈퇴 · SNU Archive" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const me = await requireMe(context);
  return { email: me.email };
}

export async function action({ context }: Route.ActionArgs) {
  await requireMe(context);
  const { response } = await context.get(apiContext).client.DELETE("/me", {
    params: { header: { "X-Confirm-Delete": "true" } },
  });
  const flash = context.get(flashContext);
  if (!response.ok) {
    flash.put("탈퇴를 처리하지 못했습니다.", "error");
    return redirect("/me");
  }
  flash.put("탈퇴했습니다.");
  return redirect("/");
}

// The confirmation step for an irreversible action. What the contract asks
// to surface before the button is listed here.
export default function DeleteAccount({ loaderData }: Route.ComponentProps) {
  return (
    <div className={s.page}>
      <section
        className={cx(ui.panel, ui.sectionBlock)}
        aria-labelledby="confirm-heading"
      >
        <div className={ui.sectionTitle}>
          <h2 id="confirm-heading">정말 탈퇴할까요?</h2>
        </div>
        <p>{loaderData.email} 계정을 탈퇴합니다. 되돌릴 수 없습니다.</p>
        <ul className={s.notes}>
          <li>
            이메일, 단과대학, 입학년도가 지워지고 모든 기기에서 로그아웃됩니다.
          </li>
          <li>
            다시 로그인하면 새 계정이 만들어지며, 이전 기여와는 연결되지
            않습니다.
          </li>
          <li>통계량과 제보에 적은 닉네임은 적은 그대로 남습니다.</li>
          <li>활동 기록은 보존 정책에 따라 삭제될 때까지 남습니다.</li>
        </ul>
        <Form method="post" className={s.actions}>
          <button className={cx(ui.button, ui.danger)} type="submit">
            탈퇴
          </button>
          <Link className={cx(ui.button, ui.subtle)} to="/me">
            취소
          </Link>
        </Form>
      </section>
    </div>
  );
}
