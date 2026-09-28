import type { Schemas } from "~/api/types";

type Action = Schemas["ActivityAction"];

// Korean names for the log's action codes. The legacy names are kept where
// an action carried over (로그인, 즐겨찾기 추가, …).
export const ACTION_LABELS: Record<Action, string> = {
  login: "로그인",
  profile_update: "프로필 수정",
  logout_all: "모든 기기 로그아웃",
  account_delete: "회원 탈퇴",
  favorite_add: "즐겨찾기 추가",
  favorite_remove: "즐겨찾기 제거",
  comment_create: "한줄 후기",
  comment_delete: "한줄 후기 삭제",
  stat_report_create: "직접 제보",
  stat_report_update: "통계량 수정",
  stat_report_move: "통계량 이동",
  stat_report_hide: "통계량 숨김",
  stat_report_unhide: "통계량 복구",
  pending_report_create: "간편 제보",
  pending_report_approve: "간편 제보 승인",
  pending_report_reject: "간편 제보 반려",
  report_file_view: "제보 파일 열람",
  sitting_create: "시험 회차 생성",
  voting_open: "투표 열기",
  voting_update: "투표 마감 변경",
  voting_close: "투표 종료",
  vote_cast: "난이도 투표",
  voting_request_create: "투표 요청",
  voting_request_cancel: "투표 요청 취소",
  voting_request_reject: "투표 요청 반려",
  admin_grant: "관리자 부여",
  admin_revoke: "관리자 회수",
  logs_export: "로그 내보내기",
  logs_delete: "로그 삭제",
  logs_clear: "로그 비우기",
  logs_retention_delete: "로그 보존 기간 삭제",
  logs_archive: "로그 보관",
};

/** Unknown future actions render as their code, as the contract asks. */
export function actionLabel(action: string): string {
  return ACTION_LABELS[action as Action] ?? action;
}

/** The legacy one-line summary of a log entry's metadata. */
export function metadataText(metadata: Record<string, unknown>): string {
  const pick = (key: string) =>
    typeof metadata[key] === "string" || typeof metadata[key] === "number"
      ? String(metadata[key])
      : "";
  return [
    pick("courseTitle"),
    pick("instructor"),
    pick("label") || pick("assessmentLabel"),
    metadata.rating ? `난이도 ${pick("rating")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
