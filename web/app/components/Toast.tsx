import { useEffect, useState } from "react";

import { cx } from "~/lib/cx";
import s from "./Toast.module.css";

type Props = {
  toast: { message: string; kind: "info" | "error" } | null;
};

const VISIBLE_MS = 2600;

/**
 * Shows the flash message the server rendered. Without JavaScript it simply
 * stays; with it, it fades out after the legacy 2.6 s.
 */
export function Toast({ toast }: Props) {
  const [hiddenFor, setHiddenFor] = useState<Props["toast"]>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setHiddenFor(toast), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const visible = toast !== null && hiddenFor !== toast;
  return (
    <div
      className={cx(s.toast, visible && s.show)}
      role="status"
      aria-live="polite"
    >
      {toast?.message}
    </div>
  );
}
