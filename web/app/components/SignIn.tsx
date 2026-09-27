import { Form } from "react-router";

import { cx } from "~/lib/cx";
import ui from "~/styles/ui.module.css";
import s from "./SignIn.module.css";

export function SignIn({ devLogin }: { devLogin: boolean }) {
  return (
    <section className={s.tile}>
      <div className={s.copy}>
        <h1>SNU Archive</h1>
        <p>서울대 강의 통계와 난이도를 빠르게 확인하세요.</p>
        {/* A document navigation: the API redirects to Google. */}
        <a
          className={cx(ui.button, ui.primary, s.heroAction)}
          href="/api/v1/auth/google"
        >
          Google로 로그인
        </a>
        {devLogin && (
          <Form method="post" action="/dev-login" className={s.devLogin}>
            <label>
              개발용 로그인
              <input
                name="email"
                type="email"
                required
                placeholder="student@snu.ac.kr"
                autoComplete="off"
              />
            </label>
            <button className={cx(ui.button, ui.subtle)} type="submit">
              로그인
            </button>
          </Form>
        )}
      </div>
    </section>
  );
}
