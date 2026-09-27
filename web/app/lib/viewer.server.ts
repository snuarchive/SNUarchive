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

/** The signed-in viewer, or a 401 that the root renders as the sign-in screen. */
export async function requireMe(
  context: Readonly<RouterContextProvider>,
): Promise<Me> {
  const me = await getMe(context);
  if (!me) throw data(null, { status: 401 });
  return me;
}

export async function requireAdmin(
  context: Readonly<RouterContextProvider>,
): Promise<Me> {
  const me = await requireMe(context);
  if (!me.isAdmin) throw data(null, { status: 403 });
  return me;
}

// Reference data changes only with a migration, so one copy per process is
// enough; it is refetched after a failure.
let configCache: Promise<Config> | null = null;

export function getConfig(
  context: Readonly<RouterContextProvider>,
): Promise<Config> {
  if (!configCache) {
    configCache = load(context.get(apiContext).client.GET("/config"));
    configCache.catch(() => {
      configCache = null;
    });
  }
  return configCache;
}
