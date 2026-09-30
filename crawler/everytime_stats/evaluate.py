"""Compare with independently, manually annotated private facts; never write labels."""
import json
from collections import Counter
from pathlib import Path

from .extract import extract_comment
from .models import ALL_FIELDS, FIELDS, digest


def code_fingerprint():
    base = Path(__file__).parent
    files = {p.name: digest(p.read_bytes()) for p in sorted(base.glob("*.py"))}
    return {"files": files, "sha256": digest(json.dumps(files, sort_keys=True).encode())}


def _fact_key(kind, number, scope, component, field, value):
    return (kind, number, scope, component, field, value)


def _record_key(record):
    required = {"year", "semester", "kind", "number", "scope", "component", "statistics", "observed_max"}
    if set(record) != required or set(record["statistics"]) != set(FIELDS):
        raise ValueError("V2 expectations require all metadata and all statistic fields, including nulls")
    return tuple(record[k] for k in ("year", "semester", "kind", "number", "scope", "component")) + tuple(record["statistics"][k] for k in FIELDS) + (record["observed_max"],)


def compare_records(expected, actual, mode):
    """Compare complete records as a multiset; identical occurrences still count."""
    if mode not in ("numeric", "all"):
        raise ValueError("records_mode must be numeric or all")
    expected_keys = Counter(_record_key(r) for r in expected)
    projected = []
    for r in actual:
        if mode == "numeric" and not any(v is not None for v in r["statistics"].values()) and r["observed_max"] is None:
            continue
        projected.append({k: r[k] for k in ("year", "semester", "scope", "component", "statistics", "observed_max")} | {k: r["assessment"][k] for k in ("kind", "number")})
    actual_keys = Counter(_record_key(r) for r in projected)
    missing = list((expected_keys-actual_keys).elements())
    unexpected = list((actual_keys-expected_keys).elements())
    return {"passed": not missing and not unexpected, "missing_records": missing, "unexpected_records": unexpected,
            "expected_records": sum(expected_keys.values()), "matched_records": sum((expected_keys & actual_keys).values()),
            "compared_actual_records": len(projected), "record_key_columns": ["year", "semester", "kind", "number", "scope", "component", *FIELDS, "observed_max"]}


def validation_metadata(fixture, current_code, declared_role=None):
    role = declared_role or fixture.get("validation_role", "legacy_unclassified")
    if role not in {"development", "known_defect_regression", "reused_regression", "independent_holdout", "legacy_unclassified"}:
        raise ValueError("Unknown validation_role")
    declared = role
    protocol = fixture.get("validation_protocol", {})
    if role == "independent_holdout":
        required = ("selected_after_rule_freeze", "annotated_before_predictions", "disjoint_from_known_cases")
        if not all(protocol.get(k) is True for k in required) or "used_for_rule_changes" not in protocol or not protocol.get("frozen_code_sha256"):
            raise ValueError("Independent validation requires explicit selection/annotation/reuse protocol")
        if protocol["used_for_rule_changes"] or protocol["frozen_code_sha256"] != current_code["sha256"]:
            role = "reused_regression"
    return {"validation_role": role, "declared_validation_role": declared, "validation_protocol": protocol,
            "independence_note": "Role is recorded from the declared selection/annotation/reuse protocol. Code hash equality alone is not evidence of independence."}


def evaluate(comments, fixture_path, declared_role=None):
    fixture_path = Path(fixture_path)
    raw = fixture_path.read_bytes()
    fixture = json.loads(raw.decode("utf-8"))
    schema = fixture.get("fixture_schema_version", 1)
    if schema not in (1, 2):
        raise ValueError("Unsupported fixture schema")
    index = {c.pointer: c for c in comments}
    seen = set()
    results = []
    for case in fixture["cases"]:
        pointer = case["json_pointer"]
        if pointer in seen:
            raise ValueError("Duplicate fixture pointer")
        seen.add(pointer)
        comment = index[pointer]
        if comment.file_sha256 != fixture["input_sha256"] or comment.source()["comment_sha256"] != case["comment_sha256"]:
            raise ValueError("Fixture source fingerprint mismatch")
        result = extract_comment(comment)
        if schema == 2:
            comparison = compare_records(case["expected_records"], result["records"], case["records_mode"])
            reasons = {reason for r in result["records"] for reason in r["review_reasons"]}
            missing_reasons = sorted(set(case.get("required_reasons", []))-reasons)
            classification_ok = result["classification"] == case["classification"]
            results.append({"json_pointer": pointer, **comparison,
                            "passed": comparison["passed"] and classification_ok and not missing_reasons,
                            "expected_classification": case["classification"], "actual_classification": result["classification"],
                            "missing_reasons": missing_reasons, "records_mode": case["records_mode"],
                            "all_actual_records": len(result["records"])})
            continue
        expected = set()
        for fact in case["facts"]:
            for field, value in fact["values"].items():
                if field not in ALL_FIELDS:
                    raise ValueError("Unknown annotated statistic field")
                expected.add(_fact_key(fact["kind"], fact["number"], fact["scope"], fact["component"], field, value))
        actual = set()
        reasons = set()
        for record in result["records"]:
            reasons.update(record["review_reasons"])
            for field in ALL_FIELDS:
                value = record["observed_max"] if field == "observed_max" else record["statistics"][field]
                if value is not None:
                    actual.add(_fact_key(record["assessment"]["kind"], record["assessment"]["number"], record["scope"], record["component"], field, value))
        missing = sorted(expected-actual, key=repr)
        unexpected = sorted(actual-expected, key=repr)
        missing_reasons = sorted(set(case.get("required_reasons", []))-reasons)
        classification_ok = result["classification"] == case["classification"]
        results.append({
            "json_pointer": pointer, "passed": not (missing or unexpected or missing_reasons) and classification_ok,
            "expected_classification": case["classification"], "actual_classification": result["classification"],
            "missing_facts": missing, "unexpected_facts": unexpected, "missing_reasons": missing_reasons,
            "expected_facts": len(expected), "recovered_facts": len(expected & actual),
            "records": len(result["records"]),
            "empty_review_records": sum(not any(v is not None for v in r["statistics"].values()) and r["observed_max"] is None for r in result["records"]),
        })
    current_code = code_fingerprint()
    return {
        "split": fixture["split"], "fixture_sha256": digest(raw), "input_sha256": fixture["input_sha256"],
        "fixture_schema_version": schema,
        "comparison_coverage": "Complete records, metadata, all values/nulls and multiplicity" if schema == 2 else "Legacy non-null fact sets only; no year/semester/null/multiplicity validation. Original expectations preserved.",
        **validation_metadata(fixture, current_code, declared_role),
        "code": current_code, "cases": len(results), "passed": sum(r["passed"] for r in results),
        "failed": sum(not r["passed"] for r in results), "results": results,
        "limitation": "Case checks are not an estimate of corpus accuracy. Empty conservative review candidates are counted separately, not numeric facts.",
    }
