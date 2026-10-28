import { useEffect, useState } from "react";
import { useFetcher, useLocation } from "react-router";

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
  const { key: locationKey } = useLocation();
  const [extra, setExtra] = useState<T[]>([]);
  const [cursor, setCursor] = useState(first.nextCursor);
  const [seen, setSeen] = useState<D | undefined>(undefined);
  const [previousKey, setPreviousKey] = useState(locationKey);

  // A navigation replaces the list, while fetcher pagination stays on the
  // same location. Reset aborts pending pages and clears retained fetcher data.
  const reset = fetcher.reset;
  useEffect(() => {
    reset();
  }, [locationKey, reset]);

  // Loader data arrives serialized; the callers' pick functions only read
  // plain JSON fields, so treat it as the declared shape.
  const data = fetcher.data as D | undefined;
  if (previousKey !== locationKey) {
    setPreviousKey(locationKey);
    setExtra([]);
    setCursor(first.nextCursor);
    // Do not fold the previous location's retained data into the new list
    // while the reset effect is waiting to run.
    setSeen(data);
  } else if (data && data !== seen) {
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
