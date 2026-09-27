/** Moves `id` one place up or down; unchanged at either end or if absent. */
export function moveBy<T>(items: T[], item: T, delta: -1 | 1): T[] {
  const from = items.indexOf(item);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= items.length) return items;
  return moveTo(items, from, to);
}

/** Moves the item at `from` so it ends up at index `to`. */
export function moveTo<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

/** Parses "3,1,2" into ids; null if any part is not a positive integer. */
export function parseIds(text: string): number[] | null {
  if (!text.trim()) return [];
  const ids = text.split(",").map((part) => Number(part.trim()));
  return ids.every((id) => Number.isInteger(id) && id > 0) ? ids : null;
}
