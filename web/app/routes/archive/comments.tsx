import { apiContext, load } from "~/api/client.server";
import { requireMe } from "~/lib/viewer.server";
import type { Route } from "./+types/comments";
import { pageUrl } from "~/lib/url.server";

// Later pages of a course's comments. Fetched by CommentsSection; opened
// directly (no JavaScript) it answers the JSON page.
export async function loader({ request, params, context }: Route.LoaderArgs) {
  await requireMe(context);
  const cursor = pageUrl(request).searchParams.get("cursor") ?? undefined;
  return load(
    context.get(apiContext).client.GET("/courses/{courseId}/comments", {
      params: {
        path: { courseId: Number(params.courseId) },
        query: { cursor },
      },
    }),
  );
}
