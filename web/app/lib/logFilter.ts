import type { Schemas } from "~/api/types";
import { ACTION_LABELS } from "./activity";
import { fromSeoulInput } from "./seoulTime";

type Action = Schemas["ActivityAction"];

export type LogFilter = {
  from?: string;
  until?: string;
  action?: Action[];
  userId?: number;
};

/**
 * Reads the log filter from the address (the filter form is a GET form).
 * Dates are datetime-local values in Seoul time.
 */
export function readLogFilter(params: URLSearchParams): LogFilter {
  const filter: LogFilter = {};
  const from = fromSeoulInput(params.get("from") ?? "");
  const until = fromSeoulInput(params.get("until") ?? "");
  if (from) filter.from = from;
  if (until) filter.until = until;
  const actions = params
    .getAll("action")
    .filter((a): a is Action => a in ACTION_LABELS);
  if (actions.length) filter.action = actions;
  const userId = Number(params.get("userId"));
  if (Number.isInteger(userId) && userId > 0) filter.userId = userId;
  return filter;
}

export function isEmptyFilter(filter: LogFilter): boolean {
  return Object.keys(filter).length === 0;
}

/** The filter's form fields as a query string, to carry it between pages. */
export function filterQuery(params: URLSearchParams): string {
  const keep = new URLSearchParams();
  for (const key of ["from", "until", "userId"]) {
    const value = params.get(key);
    if (value) keep.set(key, value);
  }
  for (const action of params.getAll("action")) keep.append("action", action);
  return keep.toString();
}
