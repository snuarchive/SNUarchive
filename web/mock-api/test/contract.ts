// Response validation against the OpenAPI 3.1 contract.
//
// openapi-backend does the OpenAPI work: dereferencing, routing a request to
// its operation, and picking the response schema for a status code. Its 3.1
// support has gaps, closed here:
//   - it checks the document against the OpenAPI 3.0 meta-schema, which
//     rejects valid 3.1 (`info.summary`, `type: [string, 'null']`); that step
//     is skipped and @seriousme/openapi-schema-validator checks the document
//     against the 3.1 meta-schema instead;
//   - it compiles schemas with Ajv's draft-07 class and ignores `format`, so
//     `customizeAjv` swaps in Ajv's 2020-12 class (the 3.1 dialect) with
//     ajv-formats;
//   - it silently passes a status the operation does not declare, and skips
//     non-JSON bodies, so status, media type and empty bodies are checked here.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { Validator } from "@seriousme/openapi-schema-validator";
import type { Document, Operation } from "openapi-backend";
import OpenAPIBackend from "openapi-backend";
import { parse } from "yaml";

/** openapi-backend with its 3.0-only document check switched off. */
class Backend extends OpenAPIBackend {
  validateDefinition(): Document {
    return this.document;
  }
}

// OPENAPI_SPEC overrides the path, e.g. to check that the suite skips cleanly.
export const SPEC_PATH =
  process.env.OPENAPI_SPEC ??
  fileURLToPath(new URL("../../api/openapi.yaml", import.meta.url));
export const specExists = existsSync(SPEC_PATH);

interface ResponseObject {
  content?: Record<string, { schema?: unknown }>;
  headers?: Record<string, { required?: boolean }>;
}

export interface CheckedResponse {
  status: number;
  headers: Headers;
  bytes: Uint8Array;
}

export class Contract {
  readonly covered = new Set<string>();
  /** operationId → statuses seen, for the report at the end. */
  readonly seen = new Map<string, Set<number>>();

  private constructor(
    readonly api: OpenAPIBackend,
    readonly operationIds: string[],
  ) {}

  static async load(): Promise<Contract> {
    const definition = parse(readFileSync(SPEC_PATH, "utf8")) as Document;
    const meta = await new Validator().validate(
      structuredClone(definition) as unknown as Parameters<
        Validator["validate"]
      >[0],
    );
    if (!meta.valid)
      throw new Error(
        `openapi.yaml is not a valid OpenAPI document:\n${JSON.stringify(meta.errors, null, 2)}`,
      );
    const api = new Backend({
      definition,
      apiRoot: "/api/v1",
      strict: true,
      validate: true,
      customizeAjv: (_draft07, opts) => {
        const ajv = new Ajv2020({
          ...opts,
          strict: false,
          allErrors: true,
          validateFormats: true,
        });
        addFormats(ajv);
        ajv.addFormat("int64", {
          type: "number",
          validate: (n: number) => Number.isSafeInteger(n),
        });
        ajv.addFormat("int32", {
          type: "number",
          validate: (n: number) => Number.isInteger(n) && Math.abs(n) < 2 ** 31,
        });
        ajv.addFormat("binary", true);
        return ajv as never;
      },
    });
    await api.init();
    const operationIds = api
      .getOperations()
      .map((o) => o.operationId!)
      .sort();
    return new Contract(api, operationIds);
  }

  match(method: string, url: string): Operation | undefined {
    const u = new URL(url, "http://mock");
    const query: Record<string, string | string[]> = {};
    for (const key of new Set(u.searchParams.keys())) {
      const all = u.searchParams.getAll(key);
      query[key] = all.length > 1 ? all : all[0];
    }
    return (
      this.api.router.matchOperation({
        method,
        path: u.pathname,
        query,
        headers: {},
      }) || undefined
    );
  }

  /** Validates the response and records the operation and status as exercised. */
  check(method: string, url: string, res: CheckedResponse): string[] {
    const id = this.match(method, url)?.operationId;
    if (id) {
      this.covered.add(id);
      const statuses = this.seen.get(id) ?? new Set<number>();
      statuses.add(res.status);
      this.seen.set(id, statuses);
    }
    return this.validate(method, url, res);
  }

  /** Returns every way the response departs from the contract; empty when it conforms. */
  validate(method: string, url: string, res: CheckedResponse): string[] {
    const op = this.match(method, url);
    if (!op) return [`${method} ${url}: no operation in the contract matches`];
    const id = op.operationId!;
    const where = `${id} ${res.status}`;
    const declared = op.responses as Record<string, ResponseObject>;
    const response =
      declared[String(res.status)] ??
      declared[`${Math.floor(res.status / 100)}XX`] ??
      declared.default;
    if (!response)
      return [
        `${where}: status not declared (declared: ${Object.keys(declared).join(", ")})`,
      ];

    const errors: string[] = [];
    const requestId = res.headers.get("x-request-id");
    if (!requestId) errors.push(`${where}: missing X-Request-ID header`);

    for (const [name, h] of Object.entries(response.headers ?? {})) {
      if (h.required && !res.headers.get(name))
        errors.push(`${where}: missing required header ${name}`);
    }
    if (
      id === "searchCourses" &&
      res.status === 200 &&
      !res.headers.get("etag")
    )
      errors.push(`${where}: missing ETag`);

    const content = response.content;
    if (!content) {
      if (res.bytes.byteLength)
        errors.push(
          `${where}: expected an empty body, got ${res.bytes.byteLength} bytes`,
        );
      return errors;
    }
    const contentType = (res.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!(contentType in content)) {
      errors.push(
        `${where}: Content-Type "${contentType}" not declared (declared: ${Object.keys(content).join(", ")})`,
      );
      return errors;
    }
    if (contentType !== "application/json") {
      if (!res.bytes.byteLength)
        errors.push(`${where}: empty ${contentType} body`);
      return errors;
    }

    let body: unknown;
    try {
      body = JSON.parse(Buffer.from(res.bytes).toString("utf8"));
    } catch {
      return [...errors, `${where}: body is not JSON`];
    }
    const result = this.api.validator.validateResponse(body, op, res.status);
    for (const e of result.errors ?? []) {
      errors.push(
        `${where}: ${e.instancePath || "(root)"} ${e.message} ${JSON.stringify(e.params)}`,
      );
    }
    if (res.status >= 400) {
      const err = (body as { error?: { requestId?: string } }).error;
      if (err?.requestId !== requestId)
        errors.push(`${where}: error.requestId does not match X-Request-ID`);
    }
    return errors;
  }
}
