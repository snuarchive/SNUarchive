import {
  type RouteConfig,
  index,
  layout,
  route,
} from "@react-router/dev/routes";

export default [
  // The search pane lives in this layout so it stays mounted while the
  // selected course changes.
  layout("routes/archive/layout.tsx", [
    index("routes/archive/home.tsx"),
    route("courses/:courseId", "routes/archive/course.tsx"),
  ]),
  route("archive", "routes/archive/reset.tsx"),
  route("search", "routes/archive/search.tsx"),
  route("courses/:courseId/favorite", "routes/archive/favorite.tsx"),
  route("courses/:courseId/comments", "routes/archive/comments.tsx"),
  route("admin/reports/:reportId/review", "routes/admin/report-review.tsx"),

  route("me", "routes/me/index.tsx"),
  route("me/delete", "routes/me/delete.tsx"),

  route("admin", "routes/admin/layout.tsx", [index("routes/admin/index.tsx")]),

  route("logout", "routes/session/logout.tsx"),
  route("dev-login", "routes/session/dev-login.tsx"),
  route("profile", "routes/session/profile.tsx"),
  route("api/v1/*", "routes/api-proxy.tsx"),

  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
