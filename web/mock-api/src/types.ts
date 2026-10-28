// The only import from the web app: the types generated from the contract.
import type { components, operations, paths } from "../../app/api/schema";

export type Schemas = components["schemas"];
export type S<K extends keyof Schemas> = Schemas[K];
export type { operations, paths };

export type Term = S<"Term">;
export type ErrorCode = S<"ErrorCode">;
export type FieldError = S<"FieldError">;
export type FieldErrorCode = FieldError["code"];
export type ActivityAction = S<"ActivityAction">;
export type ExportFormat = S<"ExportFormat">;
export type JobName = S<"JobName">;
export type ReportContentType = S<"PendingReport">["file"]["contentType"];
