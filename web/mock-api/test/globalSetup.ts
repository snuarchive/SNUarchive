// Runs in the main vitest process, where output is not captured, so the skip
// notice is visible in every reporter.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export default function setup(): void {
  const spec =
    process.env.OPENAPI_SPEC ??
    fileURLToPath(new URL("../../api/openapi.yaml", import.meta.url));
  if (!existsSync(spec)) {
    console.warn(
      `\n⚠ Skipping contract tests: ${spec} not found.\n` +
        "  web/api/openapi.yaml is an uncommitted symlink into the go-backend worktree. Create it with:\n" +
        "    ln -s ../../../go-backend/docs/api/openapi.yaml web/api/openapi.yaml\n",
    );
  }
}
