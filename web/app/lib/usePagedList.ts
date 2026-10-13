import { useState } from "react";
import { useFetcher } from "react-router";

type Page<T> = { items: T[]; nextCursor: string | null };

/**
 * A list whose later pages are fetched from `endpoint(cursor)` and appended.
 * Each fetched page is folded in during render, the first time it is seen.
 * `pick` extracts the page when the endpoint is a route whose loader returns
 * more than the page.
 */
export function usePagedList<T, D = Page<T>>(
  first: Page<T>,
  endpoint: (cursor: string) => string,
  pick: (data: D) => Page<T> = (data) => data as unknown as Page<T>,
) {
  const fetcher = useFetcher<D>();
  const [extra, setExtra] = useState<T[]>([]);
  const [cursor, setCursor] = useState(first.nextCursor);
  const [seen, setSeen] = useState<D | undefined>(undefined);

  // Loader data arrives serialized; the callers' pick functions only read
  // plain JSON fields, so treat it as the declared shape.
  const data = fetcher.data as D | undefined;
  if (data && data !== seen) {
    const page = pick(data);
    setSeen(data);
    setExtra((items) => [...items, ...page.items]);
    setCursor(page.nextCursor);
  }

  const loading = fetcher.state !== "idle";
  const loadMore = () => {
    if (cursor && !loading) fetcher.load(endpoint(cursor));
  };

  return { items: [...first.items, ...extra], cursor, loading, loadMore };
}
