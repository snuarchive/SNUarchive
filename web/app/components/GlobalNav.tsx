import { Form, Link, NavLink, useLocation } from "react-router";

import { cx } from "~/lib/cx";
import ui from "~/styles/ui.module.css";
import s from "./GlobalNav.module.css";

type Props = {
  me: { email: string; isAdmin: boolean } | null;
};

export function GlobalNav({ me }: Props) {
  const { pathname } = useLocation();
  const inAdmin = pathname === "/admin" || pathname.startsWith("/admin/");

  return (
    <header className={s.nav}>
      <div className={s.inner}>
        <div className={s.brand}>
          <strong>SNU Archive</strong>
        </div>
        {me?.isAdmin && (
          <nav className={s.viewTabs} aria-label="보기 전환">
            {/* /archive forgets the last course, so this opens an empty search. */}
            <Link to="/archive" className={cx(!inAdmin && s.active)}>
              Archive
            </Link>
            <NavLink
              to="/admin"
              className={({ isActive }) => cx(isActive && s.active)}
            >
              Admin
            </NavLink>
          </nav>
        )}
        <div className={s.auth}>
          {me ? (
            <>
              <Link to="/me" className={s.email}>
                {me.email}
                {me.isAdmin ? " · 관리자" : ""}
              </Link>
              <Link to="/me" className={s.accountShort}>
                계정
              </Link>
              <Form method="post" action="/logout">
                <button className={cx(ui.button, ui.subtle)} type="submit">
                  로그아웃
                </button>
              </Form>
            </>
          ) : (
            <a className={cx(ui.button, ui.primary)} href="/api/v1/auth/google">
              Google 로그인
            </a>
          )}
        </div>
      </div>
    </header>
  );
}
