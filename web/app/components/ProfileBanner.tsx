import { Form, useLocation } from "react-router";

import { cx } from "~/lib/cx";
import { shortYear } from "~/lib/profile";
import ui from "~/styles/ui.module.css";
import s from "./ProfileBanner.module.css";

type Props = {
  colleges: { name: string }[];
  suggestedAdmissionYear: number | null | undefined;
};

export function ProfileBanner({ colleges, suggestedAdmissionYear }: Props) {
  const location = useLocation();
  const here = location.pathname + location.search;

  return (
    <section className={s.banner}>
      <div className={s.copy}>
        <strong>학과 통계에 참여해보세요</strong>
        <span>
          단과대학 · 입학년도(선택)만 입력하면 학과별 이용 현황에 반영돼요.
          이름은 수집하지 않습니다.
        </span>
      </div>
      <Form method="post" action="/profile" className={s.form}>
        <input type="hidden" name="redirectTo" value={here} />
        <select name="college" aria-label="단과대학" defaultValue="">
          <option value="">단과대학 선택</option>
          {colleges.map((college) => (
            <option key={college.name} value={college.name}>
              {college.name}
            </option>
          ))}
        </select>
        <input
          name="admissionYear"
          type="text"
          inputMode="numeric"
          maxLength={4}
          placeholder="입학년도(예: 21)"
          aria-label="입학년도"
          defaultValue={shortYear(suggestedAdmissionYear)}
        />
        <button
          className={cx(ui.button, ui.primary)}
          type="submit"
          name="intent"
          value="banner"
        >
          저장
        </button>
        <button
          className={cx(ui.button, ui.subtle)}
          type="submit"
          name="intent"
          value="dismiss"
        >
          나중에
        </button>
      </Form>
    </section>
  );
}
