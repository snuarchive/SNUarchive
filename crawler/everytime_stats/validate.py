"""Conservative classification; no correction, imputation or DB writes."""
from decimal import Decimal

from .models import ALL_FIELDS

REASON_GROUPS = {
    "temporal_metadata": {"missing_year", "missing_semester", "ambiguous_term"},
    "assessment_identity_or_scope": {"missing_assessment", "missing_number", "unsupported_assessment_number", "uncertain_assessment_scope", "partial_assessment_scope", "composite_assessment_scope"},
    "model_mapping": {"observed_max_q4_mapping_unresolved", "unsupported_numbered_kind"},
}


def candidate_tier(record):
    if any(record["statistics"][k] is not None for k in ("q1", "q2", "q3", "q4", "average")):
        return "quartiles_or_average"
    if record["statistics"]["max_score"] is not None or record["observed_max"] is not None:
        return "bounds_only"
    return "mention_only"


def validate_record(record):
    reasons = set(record["review_reasons"])
    kind, number = record["assessment"]["kind"], record["assessment"]["number"]
    if record["year"] is None:
        reasons.add("missing_year")
    if record["semester"] is None:
        reasons.add("missing_semester")
    if kind is None:
        reasons.add("missing_assessment")
    if kind in ("exam", "quiz", "assignment"):
        if number is None:
            reasons.add("missing_number")
        elif not 1 <= number <= (6 if kind == "exam" else 20):
            reasons.add("unsupported_assessment_number")
    elif number is not None:
        reasons.add("unsupported_numbered_kind")
    if record["scope"] == "section":
        reasons.add("partial_assessment_scope")
    elif record["scope"] == "composite":
        reasons.add("composite_assessment_scope")
    elif record["scope"] == "unknown":
        reasons.add("uncertain_assessment_scope")
    if record["observed_max"] is not None:
        reasons.add("observed_max_q4_mapping_unresolved")
    figures = record["statistics"]
    quartiles = [Decimal(str(figures[f"q{i}"])) for i in range(1, 5) if figures[f"q{i}"] is not None]
    if any(a > b for a, b in zip(quartiles, quartiles[1:])):
        reasons.add("out_of_order_quartiles")
    values = [Decimal(str(v)) for v in figures.values() if v is not None]
    if any(v < 0 for v in values) or figures["max_score"] == 0:
        reasons.add("invalid_score_range")
    maximum = figures["max_score"]
    if maximum is not None and any(v is not None and v > maximum for k, v in figures.items() if k != "max_score"):
        reasons.add("above_max_score")
    if record["observed_max"] is not None and maximum is not None and record["observed_max"] > maximum:
        reasons.add("observed_max_above_max_score")
    if not values and record["observed_max"] is None:
        reasons.add("unsupported_stat_expression")
    record["review_reasons"] = sorted(reasons)
    record["candidate_tier"] = candidate_tier(record)
    record["review_issues"] = {group: sorted(reasons & members) for group, members in REASON_GROUPS.items()}
    record["review_issues"]["value_interpretation"] = sorted(reasons - set().union(*REASON_GROUPS.values()))
    record["status"] = "review_required" if reasons else "accepted"
    return record


def check_evidence(record, text):
    """Check original Unicode code-point offsets, including context and rejected candidates."""
    for name in ("evidence", "candidates", "context_evidence"):
        for item in record.get(name, []):
            a, b = item["start"], item["end"]
            if not (0 <= a < b <= len(text)) or text[a:b] != item["text"]:
                raise ValueError(f"Evidence span mismatch: {name}")
    for field in ALL_FIELDS:
        value = record["observed_max"] if field == "observed_max" else record["statistics"][field]
        if value is not None and not any(e.get("field") == field and e.get("value") == value for e in record["evidence"]):
            raise ValueError(f"No evidence for {field}")
