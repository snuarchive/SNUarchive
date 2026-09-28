import type { Schemas } from "~/api/types";

type ErrorCode = Schemas["ErrorCode"];
type FieldCode = Schemas["FieldError"]["code"];

// The contract says error.message is a fallback, not UI copy; the client owns
// the wording per code.
const CODE_MESSAGES: Partial<Record<ErrorCode, string>> = {
  NOT_AUTHENTICATED: "로그인이 필요합니다.",
  CSRF_INVALID:
    "요청이 만료되었습니다. 페이지를 새로고침한 뒤 다시 시도해주세요.",
  ADMIN_REQUIRED: "관리자만 할 수 있습니다.",
  NOT_FOUND: "대상을 찾을 수 없습니다.",
  VALIDATION_FAILED: "입력값을 확인해주세요.",
  VOTING_ALREADY_OPEN: "이미 투표가 열려 있습니다.",
  VOTING_NOT_OPEN: "투표가 열려 있지 않습니다.",
  VOTING_REQUEST_EXISTS: "이미 이 시험에 투표를 요청했습니다.",
  VOTING_REQUEST_NOT_OPEN: "이미 처리된 요청입니다.",
  NOT_REQUEST_OWNER: "본인의 요청만 취소할 수 있습니다.",
  REPORT_ALREADY_REVIEWED: "이미 처리된 제보입니다.",
  FILE_TOO_LARGE: "파일이 너무 큽니다.",
  FILE_TYPE_REJECTED: "PDF, PNG, JPEG, WebP 파일만 올릴 수 있습니다.",
  LAST_ADMIN_PROTECTED: "마지막 관리자는 해제할 수 없습니다.",
  ENV_ADMIN_PROTECTED: "환경변수로 지정된 관리자는 여기서 해제할 수 없습니다.",
  EXPORT_TOO_LARGE: "내보낼 로그가 너무 많습니다. 기간을 좁혀주세요.",
  DELETE_PREVIEW_MISMATCH:
    "미리보기 이후 로그가 바뀌었습니다. 다시 확인해주세요.",
  JOB_DISABLED: "꺼져 있는 작업입니다.",
  JOB_ALREADY_RUNNING: "이미 실행 중인 작업입니다.",
};

const FIELD_MESSAGES: Partial<Record<FieldCode, string>> = {
  REQUIRED: "필수 항목입니다.",
  TOO_LONG: "너무 깁니다.",
  QUARTILES_OUT_OF_ORDER: "Q1 ≤ Q2 ≤ Q3 ≤ Q4 순서여야 합니다.",
  VALUE_ABOVE_MAX_SCORE: "만점보다 클 수 없습니다.",
  VALUE_OUT_OF_RANGE: "범위를 벗어난 값입니다.",
  NOTHING_SUBMITTED: "수치나 비고를 하나 이상 입력해주세요.",
  UNKNOWN_ASSESSMENT_KIND: "시험 종류를 확인해주세요.",
  INVALID_ASSESSMENT_NUMBER: "시험 번호를 확인해주세요.",
  INVALID_TERM: "연도와 학기를 확인해주세요.",
  INVALID_COLLEGE: "단과대학을 확인해주세요.",
  INVALID_ADMISSION_YEAR: "입학년도를 확인해주세요.",
  INVALID_EMAIL: "이메일을 확인해주세요.",
  CLOSES_AT_IN_PAST: "마감 시각은 지금 이후여야 합니다.",
  WINDOW_INVERTED: "시작이 끝보다 늦습니다.",
  INVALID_FAVORITE_ORDER:
    "즐겨찾기 목록이 바뀌었습니다. 새로고침한 뒤 다시 시도해주세요.",
};

export function errorMessage(error: {
  code: ErrorCode;
  message: string;
}): string {
  return CODE_MESSAGES[error.code] ?? error.message;
}

export function fieldMessage(code: FieldCode): string {
  return FIELD_MESSAGES[code] ?? "입력값을 확인해주세요.";
}

/**
 * Field errors keyed by field name, first message wins. The contract uses
 * the field "" for errors about the body as a whole or several fields at
 * once (e.g. quartile order); formMessage() picks that one.
 */
export function fieldErrors(
  fields: Schemas["FieldError"][],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) out[field.field] ??= fieldMessage(field.code);
  return out;
}

/** The message for the whole form: a "" field error, else the code's. */
export function formMessage(
  error: { code: ErrorCode; message: string },
  fields: Schemas["FieldError"][],
): string {
  const whole = fields.find((field) => field.field === "");
  return whole ? fieldMessage(whole.code) : errorMessage(error);
}

/**
 * One line for a failure shown away from any field (a toast, a note by a
 * filter): the first field error's wording if there is one, else the code's.
 */
export function failureText(
  error: { code: ErrorCode; message: string },
  fields: Schemas["FieldError"][],
): string {
  return fields[0] ? fieldMessage(fields[0].code) : errorMessage(error);
}
