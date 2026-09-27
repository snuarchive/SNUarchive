// Regenerates app/api/schema.d.ts from the contract. api/openapi.yaml is an
// uncommitted symlink into the go-backend worktree; the generated file is
// committed so builds work where the symlink is absent. The header records
// which backend commit the types came from.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const spec = "api/openapi.yaml";
const out = "app/api/schema.d.ts";

if (!existsSync(spec)) {
  console.error(
    `${spec} is missing. Link it to the go-backend worktree first:\n` +
      "  ln -s ../../../go-backend/docs/api/openapi.yaml api/openapi.yaml",
  );
  process.exit(1);
}

const specDir = dirname(realpathSync(spec));
const git = (...args) =>
  execFileSync("git", ["-C", specDir, ...args], { encoding: "utf8" }).trim();
const commit = git("log", "-1", "--format=%h", "--", "openapi.yaml");
const dirty = git("status", "--porcelain", "--", "openapi.yaml") !== "";
const version = /^\s*version:\s*(\S+)/m.exec(readFileSync(spec, "utf8"))?.[1];

execFileSync("pnpm", ["exec", "openapi-typescript", spec, "-o", out], {
  stdio: "inherit",
});

const header =
  `// Contract ${version ?? "unknown"} from go-backend commit ${commit}` +
  `${dirty ? " (with uncommitted changes)" : ""}.\n` +
  "// Regenerate with `pnpm api:types`; do not edit by hand.\n";
writeFileSync(out, header + readFileSync(out, "utf8"));
