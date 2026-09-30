"""Windows/PowerShell CLI. All generated artifacts stay in crawler/output/."""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
from pathlib import Path
import random
import sys

from .evaluate import code_fingerprint, evaluate
from .extract import RULE_VERSION, extract_comment
from .models import digest
from .review import build_review_materials
from .sources import link_workbook, load_comments

CRAWLER = Path(__file__).resolve().parents[1]
PRIVATE = CRAWLER / "data" / "private"
OUTPUT = CRAWLER / "output"
DEFAULT_JSON = PRIVATE / "everytime_강의평_숫자포함_전체 (1).json"
DEFAULT_XLSX = PRIVATE / "everytime_시험점수_통계량.xlsx"


def _output_dir(argument, command):
    path = Path(argument).resolve() if argument else OUTPUT / (command + "_" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
    if not path.is_relative_to(OUTPUT.resolve()) or path == OUTPUT.resolve():
        raise ValueError("Output must be a new subdirectory of crawler/output/")
    path.mkdir(parents=True, exist_ok=False)
    return path


def _write(path, value):
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")


def _jsonl(path, values):
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        for value in values:
            stream.write(json.dumps(value, ensure_ascii=False, allow_nan=False) + "\n")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("profile", "check-samples", "extract"))
    parser.add_argument("--input-json", type=Path, default=DEFAULT_JSON)
    parser.add_argument("--xlsx", type=Path, default=DEFAULT_XLSX)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--split", choices=("development", "validation"), default="development")
    parser.add_argument("--fixture", type=Path, help="Additional manual fixture under crawler/data/private/")
    parser.add_argument("--validation-role", choices=("development", "known_defect_regression", "reused_regression"), help="Explicitly record reuse without editing a frozen fixture")
    parser.add_argument("--all", action="store_true", help="Explicitly process the entire JSON corpus")
    args = parser.parse_args(argv)
    if args.command == "extract" and not args.all:
        parser.error("extract requires --all; run check-samples first")
    comments, profile = load_comments(args.input_json)
    output = _output_dir(args.output, args.command)
    if args.command == "check-samples":
        fixture = args.fixture.resolve() if args.fixture else PRIVATE / "fixtures" / (args.split + ".json")
        if not fixture.resolve().is_relative_to(PRIVATE.resolve()):
            raise ValueError("Manual fixtures must remain under crawler/data/private/")
        role = None if args.fixture else "development" if args.split == "development" else "reused_regression"
        role = args.validation_role or role
        report = evaluate(comments, fixture, declared_role=role)
        _write(output / "sample_report.json", report)
        print(json.dumps({"output": str(output), "split": report["split"], "validation_role": report["validation_role"], "cases": report["cases"], "passed": report["passed"], "failed": report["failed"]}, ensure_ascii=False))
        return 1 if report["failed"] else 0
    links, workbook = link_workbook(args.xlsx, comments)
    summary = {"rule_version": RULE_VERSION, "code": code_fingerprint(), "json": profile, "xlsx": workbook}
    _jsonl(output / "xlsx_links.jsonl", links)
    if args.command == "profile":
        _write(output / "summary.json", summary)
        print(json.dumps({"output": str(output), **summary["json"], "xlsx": workbook}, ensure_ascii=False))
        return 0
    refs = defaultdict(list)
    for link in links:
        for match in link["matches"]:
            refs[match["json_pointer"]].append({k: link[k] for k in ("sheet", "row", "cell", "xlsx_sha256")})
    outputs = {"accepted": [], "review_required": [], "excluded": []}
    comment_counts, kinds, scopes, reasons, excluded_reasons = (Counter() for _ in range(5))
    tiers = Counter({k: 0 for k in ("quartiles_or_average", "bounds_only", "mention_only")})
    issue_counts = Counter({k: 0 for k in ("value_interpretation", "assessment_identity_or_scope", "temporal_metadata", "model_mapping")})
    measurement_decisions = []
    results = {}
    for comment in comments:
        result = extract_comment(comment)
        results[comment.pointer] = result
        comment_counts[result["classification"]] += 1
        if result["non_score_evidence"]:
            measurement_decisions.append({"source": comment.source(), "non_score_evidence": result["non_score_evidence"]})
        for record in result["records"]:
            record["xlsx_refs"] = refs[comment.pointer]
            outputs[record["status"]].append(record)
            kinds[record["assessment"]["kind"] or "unknown"] += 1
            scopes[record["scope"]] += 1
            reasons.update(record["review_reasons"])
            tiers[record["candidate_tier"]] += 1
            issue_counts.update(k for k, values in record["review_issues"].items() if values)
        if result["excluded"]:
            outputs["excluded"].append(result["excluded"])
            excluded_reasons[result["excluded"]["reason"]] += 1
    assert sum(comment_counts.values()) == len(comments)
    assert sum(kinds.values()) == len(outputs["accepted"]) + len(outputs["review_required"])
    assert digest(args.input_json.read_bytes()) == profile["sha256"]
    assert digest(args.xlsx.read_bytes()) == workbook["sha256"]
    for category, records in outputs.items():
        _jsonl(output / (category + ".jsonl"), records)
    _jsonl(output / "measurement_decisions.jsonl", measurement_decisions)
    reserved = set()
    for fp in (PRIVATE / "fixtures").glob("*.json"):
        fixture = json.loads(fp.read_text(encoding="utf-8"))
        if isinstance(fixture, dict):
            reserved.update(c["json_pointer"] for c in fixture.get("cases", [])
                            if isinstance(c, dict) and "json_pointer" in c)
    review = build_review_materials(comments, results, reserved_pointers=reserved)
    assert review["summary"]["numeric_candidates"] == tiers["quartiles_or_average"] + tiers["bounds_only"]
    _jsonl(output / "review_queue.jsonl", review["queue"])
    _write(output / "omission_samples.json", review["omission_samples"])
    summary.update({
        "execution_completed": True,
        "data_validation": {"status": "partial", "note": "Full corpus verification is not complete; sample reports and manual audits must be read separately."},
        "comments_processed": len(comments), "comment_classification": dict(comment_counts),
        "comment_classification_policy": "Review takes precedence if any assessment candidate needs review. Otherwise accepted if any candidate, otherwise excluded.",
        "output_rows": {k: len(v) for k, v in outputs.items()},
        "assessment_candidates": sum(kinds.values()), "candidates_by_kind": dict(kinds), "candidates_by_scope": dict(scopes),
        "review_reasons": dict(reasons.most_common()), "exclusion_reasons": dict(excluded_reasons),
        "candidate_tiers": dict(tiers), "numeric_candidates": tiers["quartiles_or_average"] + tiers["bounds_only"],
        "review_issue_counts": dict(issue_counts),
        "review_issue_counting_note": "Candidate tiers partition rows. Issue groups overlap; value ambiguity and missing temporal metadata are separate.",
        "non_score_measurements": sum(len(r["non_score_evidence"]) for r in measurement_decisions),
        "human_review": review["summary"],
        "counting_note": "Accepted/review rows are assessment candidates; excluded rows are comments. Empty unresolved candidates are included; these counts are not verified exam distributions.",
    })
    _write(output / "summary.json", summary)
    # Reproducible post-run selection, excluding known manual fixtures.
    rng = random.Random(20260930)
    sample = {}
    for category, rows in outputs.items():
        eligible = [r for r in rows if r["source"]["json_pointer"] not in reserved]
        rng.shuffle(eligible)
        seen, selected = set(), []
        for r in eligible:
            pointer = r["source"]["json_pointer"]
            if pointer in seen:
                continue
            selected.append(r); seen.add(pointer)
            if len(selected) == 5:
                break
        sample[category] = selected
    _write(output / "audit_selection.json", {"seed": 20260930, "rule": "Up to five distinct comments per output category, excluding all pointers recorded in private fixture cases. Candidate-row sampling is not a population accuracy estimate.", "samples": sample})
    print(json.dumps({"output": str(output), "comments_processed": len(comments), "comment_classification": dict(comment_counts), "output_rows": summary["output_rows"], "assessment_candidates": summary["assessment_candidates"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        raise SystemExit(main())
    except (ValueError, OSError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(2)
