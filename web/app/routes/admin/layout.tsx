import { NavLink, Outlet } from "react-router";

const tabs = [
  { to: "reports", label: "제보 관리" },
  { to: "stats", label: "최근 통계량" },
  { to: "logs", label: "로그 보기" },
  { to: "colleges", label: "학과 통계" },
];

export default function AdminLayout() {
  return (
    <section>
      <header>
        <div>
          <p>관리자</p>
          <h1>제보 확인 및 통계량 수정</h1>
        </div>
        <nav aria-label="관리자 메뉴">
          {tabs.map((tab) => (
            <NavLink key={tab.to} to={tab.to}>
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <Outlet />
    </section>
  );
}
