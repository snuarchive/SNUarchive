import { useState } from "react";
import { useFetcher } from "react-router";

type Page<T> = { items: T[]; nextCursor: string | null };

/**
 * A list whose later pages are fetched from `endpoint(cursor)` and appended.
 * Each fetched page is folded in during render, the first time it is seen.
 */
export function usePagedList<T>(
  first: Page<T>,
  endpoint: (cursor: string) => string,
) {
  const fetcher = useFetcher<Page<T>>();
  const [extra, setExtra] = useState<T[]>([]);
  const [cursor, setCursor] = useState(first.nextCursor);
  const [seen, setSeen] = useState<Page<T> | undefined>(undefined);

  if (fetcher.data && fetcher.data !== seen) {
    const page = fetcher.data;
    setSeen(page);
    setExtra((items) => [...items, ...page.items]);
    setCursor(page.nextCursor);
  }

  const loading = fetcher.state !== "idle";
  const loadMore = () => {
    if (cursor && !loading) fetcher.load(endpoint(cursor));
  };

  return { items: [...first.items, ...extra], cursor, loading, loadMore };
}
