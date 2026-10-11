// Runs in the main vitest process, where output is not captured, so the skip
// notice is visible in every reporter. In CI a missing contract fails the run
// instead, so the contract tests cannot be skipped silently.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export default function setup(): void {
  const spec =
    process.env.OPENAPI_SPEC ??
    fileURLToPath(new URL("../../api/openapi.yaml", import.meta.url));
  if (existsSync(spec)) return;
  if (process.env.CI) {
    throw new Error(`Contract tests need ${spec}, which was not found.`);
  }
  console.warn(
    `\n⚠ Skipping contract tests: ${spec} not found.\n` +
      "  web/api/openapi.yaml is a committed symlink to docs/api/openapi.yaml; check that the checkout kept it.\n",
  );
}
