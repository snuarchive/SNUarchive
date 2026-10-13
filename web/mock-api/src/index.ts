import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { optionsFromEnv } from "./config";

const options = optionsFromEnv();
const { app, ctx } = createApp(options);

serve({ fetch: app.fetch, port: options.port }, (info) => {
  console.log(`SNU Archive mock API on http://localhost:${info.port}/api/v1`);
  console.log(
    `  catalog: ${ctx.catalog.courses.length} courses (${ctx.catalog.sourceLabel})`,
  );
  console.log(
    `  APP_ORIGIN=${options.appOrigin}  ADMIN_EMAILS=${options.adminEmails.join(",") || "(none)"}`,
  );
  console.log(
    "  accounts: admin@snu.ac.kr (admin), student@snu.ac.kr, newbie@snu.ac.kr, moderator@snu.ac.kr (DB admin)",
  );
  console.log(
    "  control: POST /__mock/reset, POST /__mock/faults, GET /__mock/health",
  );
});
