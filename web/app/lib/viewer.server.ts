import { data, type RouterContextProvider } from "react-router";

import { apiContext, load, type Schemas } from "~/api/client.server";

export type Me = Schemas["Me"];
export type Config = Schemas["Config"];

// Loaders of one request run in parallel and several need the viewer, so the
// /me call is shared per API session.
const meByRequest = new WeakMap<object, Promise<Me | null>>();

export function getMe(
  context: Readonly<RouterContextProvider>,
): Promise<Me | null> {
  const api = context.get(apiContext);
  let pending = meByRequest.get(api);
  if (!pending) {
    pending = api.signedIn
      ? api.client.GET("/me").then(({ data: me, response }) => {
          if (response.ok) return me ?? null;
          if (response.status === 401) return null;
          throw data(null, { status: response.status });
        })
      : Promise.resolve(null);
    meByRequest.set(api, pending);
  }
  return pending;
}

/** What the sign-in screen needs when it renders without the root's data. */
export type SignInOptions = { devLogin: boolean };

/**
 * The signed-in viewer, or a 401 that the root renders as the sign-in screen.
 * Thrown from middleware, the 401 stops every loader, the root's included, so
 * it carries the sign-in options itself.
 */
export async function requireMe(
  context: Readonly<RouterContextProvider>,
): Promise<Me> {
  const me = await getMe(context);
  if (!me) throw data(await signInOptions(context), { status: 401 });
  return me;
}

/** Whether the sign-in screen offers dev login; the API decides. */
export async function signInOptions(
  context: Readonly<RouterContextProvider>,
): Promise<SignInOptions> {
  try {
    return { devLogin: (await getConfig(context)).devLoginEnabled };
  } catch {
    // The sign-in screen still works with Google alone.
    return { devLogin: false };
  }
}

export async function requireAdmin(
  context: Readonly<RouterContextProvider>,
): Promise<Me> {
  const me = await requireMe(context);
  if (!me.isAdmin) throw data(null, { status: 403 });
  return me;
}

// The API serves /config with max-age=300, so one copy per process is kept
// that long; it is refetched sooner after a failure.
const CONFIG_TTL_MS = 5 * 60 * 1000;
let configCache: { pending: Promise<Config>; expires: number } | null = null;

export function getConfig(
  context: Readonly<RouterContextProvider>,
): Promise<Config> {
  if (!configCache || configCache.expires <= Date.now()) {
    const pending = load(context.get(apiContext).client.GET("/config"));
    configCache = { pending, expires: Date.now() + CONFIG_TTL_MS };
    pending.catch(() => {
      if (configCache?.pending === pending) configCache = null;
    });
  }
  return configCache.pending;
}
