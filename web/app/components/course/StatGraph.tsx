import { cx } from "~/lib/cx";
import { displayNumber } from "~/lib/format";
import { statGraphModel } from "~/lib/statGraph";
import s from "./StatGraph.module.css";

type Props = Parameters<typeof statGraphModel>[0];

export function StatGraph(stat: Props) {
  const model = statGraphModel(stat);
  if (model.empty)
    return <div className={s.empty}>표시할 점수 정보가 없습니다.</div>;

  return (
    <div className={s.graph} aria-label="Q1 Q2 Q3 평균 분포">
      <div className={s.axis}>
        {model.range && (
          <span
            className={s.range}
            style={{
              left: `${model.range.left}%`,
              width: `${model.range.width}%`,
            }}
          />
        )}
        {model.markers.map((marker) => (
          <span
            key={marker.key}
            className={cx(s.marker, s[marker.key])}
            style={{ left: `${marker.left}%` }}
            data-label={marker.label}
            title={`${marker.label} ${displayNumber(marker.value)}`}
          />
        ))}
      </div>
      <div className={s.scale}>
        <span>0</span>
        <span>{model.scaleLabel}</span>
      </div>
    </div>
  );
}
