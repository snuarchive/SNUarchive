import { Form, Link, redirect } from "react-router";

import { apiContext, failureOf, load, type Schemas } from "~/api/client.server";
import { FavoriteOrder } from "~/components/FavoriteOrder";
import { cx } from "~/lib/cx";
import { failureText } from "~/lib/errors";
import { flashContext } from "~/lib/flash.server";
import { parseIds } from "~/lib/order";
import { getConfig, requireMe } from "~/lib/viewer.server";
import ui from "~/styles/ui.module.css";
import type { Route } from "./+types/index";
import s from "./me.module.css";

export function meta(): Route.MetaDescriptors {
  return [{ title: "내 계정 · SNU Archive" }];
}

// Favourites are few; read every page so the whole list can be reordered.
const FAVORITE_PAGE = 50;
const MAX_FAVORITE_PAGES = 20;

export async function loader({ context }: Route.LoaderArgs) {
  const [me, config] = await Promise.all([
    requireMe(context),
    getConfig(context),
  ]);
  const client = context.get(apiContext).client;
  const favorites: Schemas["CourseSummary"][] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_FAVORITE_PAGES; page++) {
    const result = await load(
      client.GET("/me/favorites", {
        params: { query: { limit: FAVORITE_PAGE, cursor } },
      }),
    );
    favorites.push(...result.items);
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return { me, colleges: config.colleges, favorites };
}

export async function action({ request, context }: Route.ActionArgs) {
  await requireMe(context);
  const form = await request.formData();
  const intent = form.get("intent");
  const flash = context.get(flashContext);

  if (intent === "reorder") {
    const ids = parseIds(String(form.get("ids") ?? ""));
    const failure = ids
      ? failureOf(
          await context
            .get(apiContext)
            .client.PUT("/me/favorites/order", { body: { ids } }),
        )
      : null;
    if (!ids || failure) {
      flash.put(
        failure
          ? failureText(failure.error, failure.fields)
          : "순서를 바꾸지 못했습니다.",
        "error",
      );
    }
    // No redirect: the drag and ↑↓ submissions come from a fetcher, and the
    // page re-renders with the saved order either way.
    return null;
  }
  if (intent !== "logout-all") return redirect("/me");

  const { response } = await context
    .get(apiContext)
    .client.POST("/me/logout-all");
  if (!response.ok) {
    flash.put("로그아웃하지 못했습니다.", "error");
    return redirect("/me");
  }
  flash.put("모든 기기에서 로그아웃했습니다.");
  return redirect("/");
}

export default function Me({ loaderData }: Route.ComponentProps) {
  const { me, colleges, favorites } = loaderData;

  return (
    <div className={s.page}>
      <header className={cx(ui.panel, s.header)}>
        <p>내 계정</p>
        <h1>{me.email}</h1>
      </header>

      <section
        className={cx(ui.panel, ui.sectionBlock)}
        aria-labelledby="profile-heading"
      >
        <div className={ui.sectionTitle}>
          <h2 id="profile-heading">프로필</h2>
          <span>학과별 이용 현황에만 쓰입니다. 이름은 수집하지 않습니다.</span>
        </div>
        <Form method="post" action="/profile" className={s.profileForm}>
          <input type="hidden" name="redirectTo" value="/me" />
          <label>
            단과대학
            <select name="college" defaultValue={me.college ?? ""}>
              <option value="">선택 안 함</option>
              {colleges.map((college) => (
                <option key={college.name} value={college.name}>
                  {college.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            입학년도
            <input
              name="admissionYear"
              type="text"
              inputMode="numeric"
              maxLength={4}
              placeholder="예: 21 또는 2021"
              defaultValue={me.admissionYear ?? ""}
            />
          </label>
          <button
            className={cx(ui.button, ui.primary)}
            type="submit"
            name="intent"
            value="save"
          >
            저장
          </button>
        </Form>
      </section>

      <section
        id="favorites"
        className={cx(ui.panel, ui.sectionBlock)}
        aria-labelledby="favorites-heading"
      >
        <div className={ui.sectionTitle}>
          <h2 id="favorites-heading">즐겨찾기</h2>
          <span>
            {favorites.length}개 · 끌어서 옮기거나 ↑↓로 순서를 바꿉니다
          </span>
        </div>
        <FavoriteOrder items={favorites} />
      </section>

      <section
        className={cx(ui.panel, ui.sectionBlock)}
        aria-labelledby="sessions-heading"
      >
        <div className={ui.sectionTitle}>
          <h2 id="sessions-heading">로그인</h2>
        </div>
        <Form method="post" className={s.row}>
          <p className={ui.muted}>
            이 기기를 포함해 로그인된 모든 기기에서 로그아웃합니다.
          </p>
          <button
            className={cx(ui.button, ui.subtle)}
            type="submit"
            name="intent"
            value="logout-all"
          >
            모든 기기에서 로그아웃
          </button>
        </Form>
      </section>

      <section
        className={cx(ui.panel, ui.sectionBlock)}
        aria-labelledby="delete-heading"
      >
        <div className={ui.sectionTitle}>
          <h2 id="delete-heading">회원 탈퇴</h2>
        </div>
        <div className={s.row}>
          <p className={ui.muted}>
            계정 정보를 지우고 모든 기기에서 로그아웃합니다.
          </p>
          <Link className={cx(ui.button, ui.danger)} to="/me/delete">
            탈퇴하기
          </Link>
        </div>
      </section>
    </div>
  );
}
