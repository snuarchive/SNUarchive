// Where E2E runs the app and the API. E2E_TARGET picks the API:
//   mock     (default) the in-memory mock, started by Playwright;
//   go       a Go server you run yourself (go run + Postgres), at
//            E2E_API_ORIGIN; Playwright starts only this app;
//   compose  the whole deploy stack behind Caddy at E2E_BASE_URL;
//            Playwright starts nothing.
// Outside the mock, E2E_RESET_CMD must put the database back to the
// backend's dev seed before each test.
export type Target = "mock" | "go" | "compose";

function target(): Target {
  const value = process.env.E2E_TARGET ?? "mock";
  if (value === "mock" || value === "go" || value === "compose") return value;
  throw new Error(`E2E_TARGET must be mock, go or compose, not "${value}"`);
}

export const TARGET = target();
export const APP_PORT = 4173;
export const MOCK_PORT = 8788;
export const MOCK_ORIGIN = `http://localhost:${MOCK_PORT}`;
export const API_ORIGIN =
  TARGET === "go"
    ? (process.env.E2E_API_ORIGIN ?? "http://localhost:8080")
    : MOCK_ORIGIN;
export const APP_ORIGIN =
  TARGET === "compose"
    ? (process.env.E2E_BASE_URL ?? "http://localhost")
    : `http://localhost:${APP_PORT}`;
export const RESET_CMD = process.env.E2E_RESET_CMD ?? "";
