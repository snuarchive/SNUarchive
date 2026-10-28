import { Link, NavLink, Outlet, useLocation } from "react-router";

import { cx } from "~/lib/cx";
import { requireAdmin } from "~/lib/viewer.server";
import ui from "~/styles/ui.module.css";
import type { Route } from "./+types/layout";
import s from "./layout.module.css";

export const GROUPS = [
  {
    path: "review",
    label: "검토",
    tabs: [
      ["reports", "제보"],
      ["statistics", "통계"],
      ["comments", "한줄평"],
    ],
  },
  {
    path: "voting",
    label: "투표",
    tabs: [
      ["sittings", "회차 관리"],
      ["requests", "요청 큐"],
    ],
  },
  {
    path: "logs",
    label: "로그",
    tabs: [
      ["entries", "조회·내보내기·삭제"],
      ["archive-runs", "보관 이력"],
    ],
  },
  {
    path: "users",
    label: "사용자",
    tabs: [
      ["summary", "학과·입학년도 통계"],
      ["lookup", "계정 조회"],
      ["admins", "관리자"],
    ],
  },
  {
    path: "ops",
    label: "운영",
    tabs: [
      ["dashboard", "대시보드"],
      ["catalog", "카탈로그"],
      ["jobs", "잡"],
    ],
  },
] as const;

// Server middleware runs for every request under /admin, actions included;
// a parent loader alone would not guard the child routes' actions.
export const middleware: Route.MiddlewareFunction[] = [
  async ({ context }) => {
    await requireAdmin(context);
  },
];

// Forces a server round trip, and so the middleware, on client-side
// navigations between admin pages.
export function loader() {
  return null;
}

export function meta(): Route.MetaDescriptors {
  return [{ title: "관리자 · SNU Archive" }];
}

export default function AdminLayout() {
  const location = useLocation();
  const groupPath = location.pathname.split("/")[2];
  const group = GROUPS.find((g) => g.path === groupPath);

  return (
    <div className={s.page}>
      <header className={cx(ui.panel, s.header)}>
        <div>
          <p>관리자</p>
          <h1>제보 확인 및 통계량 수정</h1>
        </div>
        <div className={s.headerActions}>
          <nav className={s.tabs} aria-label="관리자 메뉴">
            {GROUPS.map((g) => (
              <NavLink
                key={g.path}
                to={`/admin/${g.path}/${g.tabs[0][0]}`}
                className={cx(g.path === groupPath && s.active)}
              >
                {g.label}
              </NavLink>
            ))}
          </nav>
          <Link
            className={cx(ui.button, ui.primary)}
            to={location.pathname + location.search}
            preventScrollReset
          >
            새로고침
          </Link>
        </div>
      </header>
      {group && (
        <nav className={s.subTabs} aria-label={`${group.label} 메뉴`}>
          {group.tabs.map(([path, label]) => (
            <NavLink
              key={path}
              to={`/admin/${group.path}/${path}`}
              className={({ isActive }) => cx(isActive && s.active)}
            >
              {label}
            </NavLink>
          ))}
        </nav>
      )}
      <Outlet />
    </div>
  );
}
