import { normalizeOrigin } from "./origin";

// Server configuration, read once at startup. APP_ENV mirrors the backend:
// it is independent of NODE_ENV, so a production build can run in development
// mode (E2E does this against the mock API).
const appEnv =
  process.env.APP_ENV === "development" ? "development" : "production";

function required(name: string, devDefault: string): string {
  const value = process.env[name];
  if (value) return value;
  if (appEnv === "development") return devDefault;
  throw new Error(`${name} must be set when APP_ENV=production`);
}

export const env = {
  appEnv,
  /** Where the React Router server reaches the API (server to server). */
  apiOrigin: required("API_ORIGIN", "http://localhost:8787"),
  /** The public origin of this app; sent as Origin on unsafe API calls. */
  appOrigin: normalizeOrigin(required("APP_ORIGIN", "http://localhost:5173")),
  /** Signs this app's own cookies (flash messages). */
  webSecret: required("WEB_SESSION_SECRET", "dev-web-session-secret"),
};
// Dev login is not configured here: the API says whether it takes it
// (/config.devLoginEnabled, always false in production).
