import { data } from "react-router";

import type { ApiFailure } from "~/api/client.server";
import { errorMessage, fieldErrors } from "./errors";
import type { ActionFailure } from "./forms";

/** A refused submission, shown next to its form with the values kept. */
export function refuse(
  intent: string,
  message: string,
  values: Record<string, string>,
  fields: Record<string, string> = {},
  status = 422,
) {
  return data<ActionFailure>({ intent, message, fields, values }, { status });
}

/** The same, from an API failure. */
export function refuseFromApi(
  intent: string,
  failure: ApiFailure,
  values: Record<string, string>,
) {
  return refuse(
    intent,
    errorMessage(failure.error),
    values,
    fieldErrors(failure.fields),
    failure.status,
  );
}
