/**
 * An origin in the form browsers send in the Origin header: lower-case scheme
 * and host, no default port, no trailing slash. The Go server compares Origin
 * with its APP_ORIGIN normalised this way, so this app must send exactly that
 * string. Anything beyond an origin (a path, query or credentials) is refused.
 */
export function normalizeOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`"${value}" is not an origin`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`"${value}" is not an http or https origin`);
  }
  if (
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(`"${value}" is not an origin: drop the path and query`);
  }
  return url.origin;
}
