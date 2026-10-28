import ui from "~/styles/ui.module.css";

/**
 * A field's error, placed after its <label> rather than inside it: text in a
 * label becomes part of the input's accessible name ("Q2 Q1 ≤ Q2 …").
 * Pair with errorAttrs() on the input.
 */
export function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <span id={id} className={ui.fieldError}>
      {message}
    </span>
  ) : null;
}

/** Marks an input invalid and points it at its FieldError. */
export function errorAttrs(id: string, message?: string) {
  return message
    ? { "aria-invalid": true as const, "aria-describedby": id }
    : {};
}
