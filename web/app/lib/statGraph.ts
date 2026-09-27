import { displayNumber, percentOf, statNumber } from "./format";

type Figures = {
  q1: number | null;
  q2: number | null;
  q3: number | null;
  q4: number | null;
  average: number | null;
  maxScore: number | null;
};

export type Marker = {
  key: "q1" | "q2" | "q3" | "average";
  label: string;
  value: number;
  left: number;
};

export type StatGraphModel =
  | { empty: true }
  | {
      empty: false;
      range: { left: number; width: number } | null;
      markers: Marker[];
      scaleLabel: string;
    };

/**
 * Geometry of the legacy score graph: the axis runs to the full mark, or to
 * the largest figure when no full mark was given; Q1–Q3 is a band and
 * Q1/Q2/Q3/average are markers.
 */
export function statGraphModel(stat: Figures): StatGraphModel {
  const values = [stat.q1, stat.q2, stat.q3, stat.q4, stat.average]
    .map(statNumber)
    .filter((v): v is number => v !== null);
  if (!values.length) return { empty: true };

  const maxScore = statNumber(stat.maxScore);
  const axisMax = Math.max(maxScore || 0, ...values, 1);
  const q1 = percentOf(stat.q1, axisMax);
  const q3 = percentOf(stat.q3, axisMax);
  const range =
    q1 !== null && q3 !== null
      ? { left: Math.min(q1, q3), width: Math.abs(q3 - q1) }
      : null;

  const points = [
    { key: "q1", label: "Q1", value: stat.q1 },
    { key: "q2", label: "Q2", value: stat.q2 },
    { key: "q3", label: "Q3", value: stat.q3 },
    { key: "average", label: "평균", value: stat.average },
  ] as const;
  const markers: Marker[] = [];
  for (const point of points) {
    const left = percentOf(point.value, axisMax);
    if (left !== null && point.value !== null) {
      markers.push({
        key: point.key,
        label: point.label,
        value: point.value,
        left,
      });
    }
  }

  return {
    empty: false,
    range,
    markers,
    scaleLabel: maxScore
      ? `만점 ${displayNumber(maxScore)}`
      : `기준 ${displayNumber(axisMax)}`,
  };
}
