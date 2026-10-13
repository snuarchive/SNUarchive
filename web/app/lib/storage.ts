// Browser storage for small conveniences (drafts, the last nickname). Any
// failure, such as a private window, just means the convenience is off.

export const DIRECT_DRAFT_KEY = "snu-archive:direct-report-draft";
export const NICKNAME_KEY = "snu-archive:last-nickname";

export function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not critical.
  }
}

export function storageRemove(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Not critical.
  }
}

export type DirectDraft = {
  /** The new API's course id; the legacy draft used courseKey. */
  courseId: number;
  values: Record<string, string>;
  savedAt: string;
};

export function loadDraft(): DirectDraft | null {
  const raw = storageGet(DIRECT_DRAFT_KEY);
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as Partial<DirectDraft>;
    // Legacy drafts keyed by courseKey cannot be matched to a course id.
    return typeof draft.courseId === "number" && draft.values
      ? (draft as DirectDraft)
      : null;
  } catch {
    return null;
  }
}

export function savedNickname(): string {
  return [...(storageGet(NICKNAME_KEY) ?? "").trim()].slice(0, 10).join("");
}
