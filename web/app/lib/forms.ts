import { useEffect, useRef, type RefObject } from "react";
import { useActionData, useNavigation } from "react-router";

/** What course-page actions return when a submission is refused. */
export type ActionFailure = {
  intent: string;
  message: string;
  fields: Record<string, string>;
  values: Record<string, string>;
};

/**
 * Clears a form after its submission succeeded. Actions redirect on success
 * and return an ActionFailure otherwise, so "the submission finished and no
 * failure came back for this intent" means success. Without JavaScript the
 * redirect reloads the page, which clears the form anyway.
 */
export function useResetOnSuccess(
  form: RefObject<HTMLFormElement | null>,
  intent: string,
) {
  const navigation = useNavigation();
  const failure = useActionData() as ActionFailure | undefined;
  const submitting = useRef(false);

  useEffect(() => {
    if (
      navigation.state === "submitting" &&
      navigation.formData?.get("intent") === intent
    ) {
      submitting.current = true;
      return;
    }
    if (navigation.state === "idle" && submitting.current) {
      submitting.current = false;
      if (failure?.intent !== intent) form.current?.reset();
    }
  }, [navigation.state, navigation.formData, failure, form, intent]);
}

/** The failure for this form, if the last submission was this one. */
export function useFailure(intent: string): ActionFailure | null {
  const failure = useActionData() as ActionFailure | undefined;
  return failure?.intent === intent ? failure : null;
}

const BLOCKED_NUMBER_KEYS = new Set(["e", "E", "+", "-"]);

/** Legacy number fields refused e, E, + and - (scientific and signed input). */
export function blockNumberKeys(event: React.KeyboardEvent<HTMLInputElement>) {
  if (BLOCKED_NUMBER_KEYS.has(event.key)) event.preventDefault();
}
