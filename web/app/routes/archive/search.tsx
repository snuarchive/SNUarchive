import { apiContext, load } from "~/api/client.server";
import { SEARCH_PAGE_SIZE as PAGE_SIZE } from "~/lib/search";
import { requireMe } from "~/lib/viewer.server";
import type { Route } from "./+types/search";

// Later search pages for infinite scroll, fetched by SearchResults.
export async function loader({ request, context }: Route.LoaderArgs) {
  await requireMe(context);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  if (!q) return { items: [], nextCursor: null };
  return load(
    context.get(apiContext).client.GET("/courses", {
      params: { query: { q, cursor, limit: PAGE_SIZE } },
    }),
  );
}
