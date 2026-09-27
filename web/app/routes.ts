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
  route("admin", "routes/admin/layout.tsx", [
    index("routes/admin/index.tsx"),
    route("reports", "routes/admin/reports.tsx"),
    route("stats", "routes/admin/stats.tsx"),
    route("logs", "routes/admin/logs.tsx"),
    route("colleges", "routes/admin/colleges.tsx"),
  ]),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
