// Regenerates app/api/schema.d.ts from the contract. api/openapi.yaml is a
// committed symlink to docs/api/openapi.yaml; the generated file is committed
// too, so builds (the Docker image, whose context is web/) work without it. The header records
// which backend commit the types came from.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const spec = "api/openapi.yaml";
const out = "app/api/schema.d.ts";

if (!existsSync(spec)) {
  console.error(
    `${spec} is missing. It is a committed symlink to docs/api/openapi.yaml;\n` +
      "restore it with: git checkout -- api/openapi.yaml",
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
// The committed copy is Prettier-formatted; keep diffs to real changes.
execFileSync("pnpm", ["exec", "prettier", "--write", out], {
  stdio: "inherit",
});
