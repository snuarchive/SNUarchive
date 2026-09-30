"""Decide measurement meaning before accepting a labelled number as a score.

Unknown units keep their literal value in review evidence, not in score fields.
The explicit non-score registry is grouped by dimension; assessment/table
context is positive evidence and never overrides an explicit incompatible unit.
"""
import re


NON_SCORE_UNITS = {
    "duration": r"시간|분(?!위)|초|개월|주일|일간",
    "document_extent": r"페이지|쪽|장|pages?\b|slides?\b",
    "count": r"문제|문항|명|개|회|번|건|권",
    "rank": r"등(?!급)|위(?!해)|순위",
    "money": r"원|달러|만원|천원",
    "physical_quantity": r"kg\b|km\b|cm\b|미터|킬로|바이트|리터",
}
NON_SCORE = re.compile(r"^\s*(?:" + "|".join(f"(?P<{k}>{v})" for k, v in NON_SCORE_UNITS.items()) + r")", re.I)
WORKLOAD = re.compile(r"리딩|읽는|읽기|ppt|슬라이드|페이지|분량|장수|발언|횟수|소요|걸리|투자|문제\s*수|문제\s*개수", re.I)
UNKNOWN = re.compile(r"단위.{0,12}(?:불명|모르|알려주지|미공개)")


def classify_quantity(prefix, tail, *, has_assessment, tabular_label, field):
    # A ratio ending in a rank/count unit is not a points ratio.
    ratio = re.match(r"\s*(?:점)?\s*/\s*\d+(?:\.\d+)?\s*(?:점)?", tail)
    suffix = tail[ratio.end():] if ratio else tail
    if re.match(r"\s*(?:%|퍼센트|퍼센티지)", suffix):
        return "unresolved", "unsupported_score_unit"
    unit = NON_SCORE.match(suffix)
    if unit:
        return "non_score", unit.lastgroup
    if UNKNOWN.search(tail):
        return "unresolved", "uncertain_stat_unit"
    if re.match(r"\s*점", tail):
        return "score", "explicit_points"
    # Workload context without its unit is still not proof of a score.
    if WORKLOAD.search(prefix):
        return "unresolved", "uncertain_stat_unit"
    if ratio:
        return "score", "labelled_score_ratio"
    if tabular_label or has_assessment or field.startswith("q"):
        return "score", "labelled_score_context"
    return "unresolved", "uncertain_stat_unit"
