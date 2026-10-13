import type { Schemas } from "~/api/types";
import { formatDateTime } from "~/lib/format";
import s from "./admin.module.css";

const SOURCE = {
  db: "DB 부여",
  env: "환경변수",
  both: "DB 부여 + 환경변수",
} as const;

export function adminSourceLabel(source: keyof typeof SOURCE | null): string {
  return source ? SOURCE[source] : "-";
}

export function UserCard({
  user,
  children,
}: {
  user: Schemas["AdminUser"];
  children?: React.ReactNode;
}) {
  return (
    <article className={s.item}>
      <header>
        <div>
          <h3>
            #{user.id} {user.email ?? "(탈퇴한 계정)"}
          </h3>
          <p>
            {user.displayName ?? "-"} · 가입 {formatDateTime(user.createdAt)} ·
            최근 {formatDateTime(user.lastSeenAt)} · IP {user.lastIp ?? "-"}
          </p>
          <p>
            {user.isAdmin
              ? `관리자 (${adminSourceLabel(user.adminSource)})`
              : "일반 사용자"}
            {user.deletedAt && ` · 탈퇴 ${formatDateTime(user.deletedAt)}`}
          </p>
        </div>
      </header>
      {children}
    </article>
  );
}
