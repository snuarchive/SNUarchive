import type { ErrorCode, FieldError, FieldErrorCode } from "./types";

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  MALFORMED_REQUEST: "요청 형식이 올바르지 않습니다.",
  NOT_AUTHENTICATED: "로그인이 필요합니다.",
  CSRF_INVALID: "요청 검증에 실패했습니다. 페이지를 새로고침해 주세요.",
  ADMIN_REQUIRED: "관리자만 사용할 수 있습니다.",
  NOT_FOUND: "찾을 수 없습니다.",
  METHOD_NOT_ALLOWED: "지원하지 않는 요청 방식입니다.",
  VALIDATION_FAILED: "입력값을 확인해 주세요.",
  CONFIRMATION_REQUIRED: "확인 헤더가 필요합니다.",
  VOTING_ALREADY_OPEN: "이미 투표가 진행 중입니다.",
  VOTING_NOT_OPEN: "투표가 열려 있지 않습니다.",
  VOTING_REQUEST_EXISTS: "이미 투표를 요청했습니다.",
  VOTING_REQUEST_NOT_OPEN: "이미 처리된 요청입니다.",
  NOT_REQUEST_OWNER: "본인의 요청만 취소할 수 있습니다.",
  REPORT_ALREADY_REVIEWED: "이미 검토된 제보입니다.",
  FILE_TOO_LARGE: "파일이 너무 큽니다.",
  FILE_TYPE_REJECTED: "지원하지 않는 파일 형식입니다.",
  LAST_ADMIN_PROTECTED: "마지막 관리자는 해제할 수 없습니다.",
  ENV_ADMIN_PROTECTED: "환경변수로 지정된 관리자는 해제할 수 없습니다.",
  EXPORT_TOO_LARGE: "내보낼 항목이 너무 많습니다. 기간을 좁혀 주세요.",
  DELETE_PREVIEW_MISMATCH:
    "미리보기와 삭제 조건이 다릅니다. 다시 미리보기 해 주세요.",
  JOB_DISABLED: "비활성화된 작업입니다.",
  JOB_ALREADY_RUNNING: "작업이 이미 실행 중입니다.",
  INTERNAL: "서버 오류가 발생했습니다.",
};

export const ERROR_CODES = Object.keys(DEFAULT_MESSAGES) as ErrorCode[];

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message ?? DEFAULT_MESSAGES[code]);
  }
}

export function errorBody(err: ApiError, requestId: string) {
  return {
    error: {
      code: err.code,
      message: err.message,
      requestId,
      ...(err.details ? { details: err.details } : {}),
    },
  };
}

export const malformed = (message?: string) =>
  new ApiError(400, "MALFORMED_REQUEST", message);
export const unauthenticated = () => new ApiError(401, "NOT_AUTHENTICATED");
export const csrfInvalid = () => new ApiError(403, "CSRF_INVALID");
export const adminRequired = () => new ApiError(403, "ADMIN_REQUIRED");
export const notFound = (message?: string) =>
  new ApiError(404, "NOT_FOUND", message);
export const conflict = (code: ErrorCode, message?: string) =>
  new ApiError(409, code, message);
export const confirmationRequired = () =>
  new ApiError(428, "CONFIRMATION_REQUIRED");

/** Collects field errors so a response reports every bad field at once. */
export class FieldErrors {
  readonly list: FieldError[] = [];

  add(field: string, code: FieldErrorCode): void {
    if (!this.list.some((e) => e.field === field && e.code === code))
      this.list.push({ field, code });
  }

  has(field: string): boolean {
    return this.list.some((e) => e.field === field);
  }

  throwIfAny(): void {
    if (this.list.length) throw validationFailed(this.list);
  }
}

export function validationFailed(fields: FieldError[]): ApiError {
  return new ApiError(422, "VALIDATION_FAILED", undefined, { fields });
}

export function fieldError(field: string, code: FieldErrorCode): ApiError {
  return validationFailed([{ field, code }]);
}
