import ui from "~/styles/ui.module.css";
import s from "./admin.module.css";

type Props = {
  rows: { label: string; count: number }[];
  empty: string;
};

/** The legacy horizontal count bars (학과·입학년도 통계). */
export function StatBars({ rows, empty }: Props) {
  if (rows.length === 0) return <div className={ui.emptySmall}>{empty}</div>;
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <div className={s.statBars}>
      {rows.map((row) => (
        <div className={s.statBarRow} key={row.label}>
          <span className={s.statBarLabel}>{row.label}</span>
          <div className={s.statBarTrack}>
            <div
              className={s.statBarFill}
              style={{ width: `${Math.round((row.count / max) * 100)}%` }}
            />
          </div>
          <span className={s.statBarCount}>{row.count}</span>
        </div>
      ))}
    </div>
  );
}
