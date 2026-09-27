import { fileURLToPath } from "node:url";

export interface MockOptions {
  port: number;
  /** Where the React app is served; OAuth redirects and the Origin check use it. */
  appOrigin: string;
  /** Where this mock is reachable by the browser; used for the fake Google page. */
  mockOrigin: string;
  adminEmails: string[];
  /** Bearer secret for `/internal/jobs/*`; null unregisters the route (404), as in the backend. */
  cronSecret: string | null;
  exportMaxRows: number;
  /** Directory holding the source term files (`2024-1.json` …). */
  catalogDir: string;
  sessionTtlMs: number;
  now: () => Date;
}

// web/mock-api/src → worktree root, where the nine source files live.
const DEFAULT_CATALOG_DIR = fileURLToPath(
  new URL("../../../", import.meta.url),
);

export function defaultOptions(
  overrides: Partial<MockOptions> = {},
): MockOptions {
  const port = overrides.port ?? 8787;
  return {
    port,
    appOrigin: "http://localhost:5173",
    mockOrigin: `http://localhost:${port}`,
    adminEmails: ["admin@snu.ac.kr"],
    cronSecret: "mock-cron-secret",
    exportMaxRows: 1000,
    catalogDir: DEFAULT_CATALOG_DIR,
    sessionTtlMs: 7 * 24 * 3600 * 1000,
    now: () => new Date(),
    ...overrides,
  };
}

export function optionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): MockOptions {
  const port = env.PORT ? Number(env.PORT) : 8787;
  const o: Partial<MockOptions> = { port };
  if (env.APP_ORIGIN) o.appOrigin = env.APP_ORIGIN.replace(/\/+$/, "");
  if (env.MOCK_ORIGIN) o.mockOrigin = env.MOCK_ORIGIN.replace(/\/+$/, "");
  if (env.ADMIN_EMAILS !== undefined)
    o.adminEmails = parseEmails(env.ADMIN_EMAILS);
  if (env.CRON_SECRET !== undefined) o.cronSecret = env.CRON_SECRET || null;
  if (env.EXPORT_MAX_ROWS) o.exportMaxRows = Number(env.EXPORT_MAX_ROWS);
  if (env.CATALOG_DIR) o.catalogDir = env.CATALOG_DIR;
  return defaultOptions(o);
}

export function parseEmails(raw: string): string[] {
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
