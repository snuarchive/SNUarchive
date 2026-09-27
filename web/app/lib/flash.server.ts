import {
  createContext,
  createCookieSessionStorage,
  type Session,
} from "react-router";

import { env } from "./env.server";

export type Toast = { message: string; kind: "info" | "error" };

type FlashData = Record<string, never>;
type FlashOnly = { toast: Toast };

const storage = createCookieSessionStorage<FlashData, FlashOnly>({
  cookie: {
    name: "web_flash",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: env.appOrigin.startsWith("https://"),
    secrets: [env.webSecret],
  },
});

/**
 * The flash session for this request. Actions put a toast in it before
 * redirecting; the next render reads it, which consumes it. The root
 * middleware commits it when either happened.
 */
export class Flash {
  private dirty = false;

  private constructor(
    private readonly session: Session<FlashData, FlashOnly>,
  ) {}

  static async from(request: Request): Promise<Flash> {
    return new Flash(await storage.getSession(request.headers.get("Cookie")));
  }

  put(message: string, kind: Toast["kind"] = "info") {
    this.session.flash("toast", { message, kind });
    this.dirty = true;
  }

  take(): Toast | null {
    const toast = this.session.get("toast") ?? null;
    if (toast) this.dirty = true;
    return toast;
  }

  async commit(): Promise<string | null> {
    return this.dirty ? storage.commitSession(this.session) : null;
  }
}

export const flashContext = createContext<Flash>();
