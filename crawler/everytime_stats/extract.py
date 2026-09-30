"""Rule-based, abstaining parser. All positions refer to the untouched JSON text.

No text from XLSX is ever passed here. Unhandled statistic markers remain review
candidates; only explicit personal expressions and text without markers are excluded.
"""
import re
from decimal import Decimal

from .models import FIELDS, SCHEMA_VERSION, digest, evidence
from .quantities import classify_quantity
from .validate import check_evidence, validate_record

RULE_VERSION = "0.1.6"
NUM = r"\d+(?:\.\d+)?"
UNIT = re.compile(
    r"(?P<mid>중간(?:고사)?)(?!값|중간)(?:\s*(?P<midn>[1-6])(?![\d./]|\s*(?:/|점|%|등|명|개|회|번|문제|년|월|일|시|분)))?"
    r"|(?<!학)(?P<final>기말(?:고사)?)(?:\s*(?P<finaln>[1-6])(?![\d./]|\s*(?:/|점|%|등|명|개|회|번|문제|년|월|일|시|분)))?"
    r"|(?P<ordinal>\d{1,2})\s*차(?:\s*(?:시험|고사))?"
    r"|(?P<quiz>퀴즈|\bquiz)(?:\s*#?(?P<quizn>\d{1,2})(?![\d./]|\s*(?:회|개|번|점|%)))?"
    r"|(?P<assignment>과제|\bhw|\bassignment)(?:\s*#?(?P<assignmentn>\d{1,2})(?![\d./]|\s*(?:회|개|번|점|%)))?"
    r"|(?P<exam>\bexam|\btest|시험)(?:\s*#?(?P<examn>\d{1,2})(?![\d./]|\s*(?:회|개|번|점|%)))?"
    r"|(?P<other>텀프로젝트|프로젝트|플젝|보고서|실험)"
    r"|(?P<total>합산|합계|합친|합쳐서|총점|총합|총\s*(?=\d+\s*점\s*만점))",
    re.I,
)
LABEL = re.compile(
    r"(?<![A-Za-z0-9])(?P<q>q\s*[1-4])(?!\d)"
    r"|(?P<average>평균|(?<![A-Za-z0-9])(?:mean|average|avg)(?![A-Za-z0-9]))"
    r"|(?P<median>중앙값|중위값|중간값|(?<![A-Za-z0-9])median(?![A-Za-z0-9]))"
    r"|(?P<observed>최고\s*점수|최고점|최댓값|최대값|(?<![A-Za-z0-9])max(?![A-Za-z0-9]))", re.I,
)
NUMBER_AFTER = re.compile(r"\s*(?:값)?\s*(?:은|는|이|가)?\s*[:=：]?\s*(?P<num>" + NUM + r")")
MAXIMUM = re.compile(
    r"(?<![A-Za-z0-9.,])(?P<before>" + NUM + r")(?:\s*점\s*만점|\s*만점(?!\s*(?:은|는|이|가|[:=：])?\s*\d))"
    r"|만점\s*(?:은|는|이|가)?\s*[:=：]?\s*(?P<after>" + NUM + r")\s*점?"
)
RATIO = re.compile(r"(?<![A-Za-z0-9.,/])(?P<personal>" + NUM + r")\s*점?\s*/\s*(?P<max>" + NUM + r")(?![\d./]|,\d)\s*점?")
MARKER = re.compile(r"(?i)(?<![A-Za-z0-9])(?:[234]\s*)?q\s*[0-4]|평균|중앙값|중위값|중위수|중간값|메디안|(?<![A-Za-z0-9])(?:mean|median|average|avg|max)(?![A-Za-z0-9])|최고\s*점수|최고점|최댓값|최대값|최저점|만점|통계량|사분위값|사분위수|분위수|분포|표준편차|(?:상위|하위)\s*\d+\s*%")
UNLABELLED_TUPLE = re.compile(r"(?<![\d./])" + NUM + r"(?:\s*/\s*" + NUM + r"){2,}(?![\d./])")
PERSONAL_Q = re.compile(r"(?i)(?<![A-Za-z0-9])(?:[234]\s*)?q\s*[1-4]\s*(?:[+\-±]\s*(?:\d+(?:\.\d+)?|[a-z]+)|(?:보다)\s*\d+(?:\s*[~～]\s*\d+)?\s*(?:점|등))")
OFFSET = re.compile(r"(?:평균|중앙값|중위값|중간값)\s*(?:보다\s*)?\d+(?:\.\d+)?\s*점?(?:\s*정도)?\s*(?:높|낮|위|아래)")
PERSONAL_FULL = re.compile(r"(?:출석|과제|중간(?:고사)?[12]?|기말(?:고사)?|저는|전부|둘\s*다)\s*만점(?!\s*(?:은|는|이|가|[:=：]|\d))|만점\s*(?:맞|받)")
PART = re.compile(r"객관식|서술형|주관식|전체")
TERM = re.compile(r"(?P<year>(?:19|20|21)\d{2})\s*년\s*(?P<semester>1\s*학기|2\s*학기|여름(?:\s*학기)?|겨울(?:\s*학기)?)")
SEMESTER_ONLY = re.compile(r"이번\s*(?P<semester>1\s*학기|2\s*학기|여름(?:\s*학기)?|겨울(?:\s*학기)?)")
SHORT_TERM = re.compile(r"(?<!\d)(?:\d{2}|20\d{2})\s*[-/]\s*(?:[12]|[SW])(?!\d)", re.I)
APPROXIMATE_TAIL = re.compile(r"\s*점?\s*(?:정도|쯤|대|내외|가량|수준|언저리|근방|근처|안팎|가까이|이상|이하|미만|넘|[~～]|±|[-–—]\s*\d)")
HYPOTHETICAL_TAIL = re.compile(r"\s*점?\s*(?:이건|이든|이?라면|든지|(?:이?라고|이라|라|으로)?\s*(?:가정|치면))")
UNCERTAIN_TAIL = re.compile(r"\s*점?\s*(?:인가(?:\s*(?:그랬|싶|기억))?|인\s*것\s*같|이었나|였나)")


def _mention_role(unit, line, offset):
    """Separate an assessment anchor from comparison/source/background nouns."""
    before, after = line[:unit["start"]-offset], line[unit["end"]-offset:]
    if re.match(r"\s*(?:보다|에\s*비해|와\s*(?:비교|동일|비슷|다르|다르게|연계)|처럼|[에애]서.{0,16}(?:나온|낸|나오|출제|한\s*문제))", after):
        return "reference"
    if unit["kind"] in ("midterm", "final") and re.match(r"\s*(?:(?:중간|기말)\s*)?(?:발표|레포트|보고서|프로젝트)", after):
        return "ambiguous"
    if unit["kind"] == "exam" and unit["number"] is None and re.search(r"(?:모든|매)\s*$", before):
        return "reference"
    heading = bool(re.fullmatch(r"\s*(?:\(?\d+[.)]\s*)?", before))
    introduction = bool(re.match(r"\s*(?:인지라|은|는|이|가|의)?\s*[:：]?\s*(?:(?:둘\s*다|모두|각각)\s*)?(?:통계|성적|점수|만점|Q\s*[0-4]|평균|중앙값|중위값|mean\b|avg\b|Max\b|\d)", after, re.I))
    if heading or introduction or unit["kind"] in ("midterm", "final") or unit["composite"]:
        return "anchor"
    if unit["kind"] == "exam" and unit["number"] is None and re.match(r"\s*(?:문제|에서|이\s*끝|이\s*아닌)", after):
        return "reference"
    return "ambiguous"


def _paragraphs(text):
    start = 0
    for m in re.finditer(r"\r?\n[ \t]*\r?\n", text):
        if text[start:m.start()].strip():
            yield start, m.start()
        start = m.end()
    if text[start:].strip():
        yield start, len(text)


def _unit(match, offset):
    g = match.groupdict()
    if g["total"]:
        kind, number = None, None
    elif g["mid"]:
        kind, number = "midterm", g["midn"]
    elif g["final"]:
        kind, number = "final", g["finaln"]
    elif g["ordinal"]:
        kind, number = "exam", g["ordinal"]
    else:
        kind = next(k for k in ("quiz", "assignment", "exam", "other") if g[k])
        number = g.get(kind + "n")
    return {"kind": kind, "number": int(number) if number else None,
            "raw_label": match.group(), "start": offset + match.start(), "end": offset + match.end(),
            "composite": bool(g["total"])}


def _number(value):
    number = Decimal(value)
    return int(number) if number == number.to_integral_value() else float(number)


def _term(text, paragraph, position, unit):
    """Only a leading header/enrollment term has comment-wide scope.

    Inline assessment dates belong to that line's anchors; bare dated headers
    apply forwards inside their paragraph. No date backfills earlier statistics.
    """
    first_unit = UNIT.search(text)
    intro_end = first_unit.start() if first_unit else len(text)
    matches = []
    global_matches = []
    for pattern in (TERM, SEMESTER_ONLY):
        for m in pattern.finditer(text):
            if re.search(r"기출|작년|지난|예년", text[max(0, m.start()-8):m.end()+12]):
                continue
            line_start = text.rfind("\n", 0, m.start()) + 1
            line_end = text.find("\n", m.end())
            line_end = len(text) if line_end < 0 else line_end
            standalone = not text[line_start:m.start()].strip() and not text[m.end():line_end].strip()
            enrollment = bool(re.search(r"수강|학생", text[:intro_end])) and not re.search(r"예정|계획|수강하[면려]|수강할", text[:intro_end])
            # A bare season mentioned during a course-history narrative is not
            # the statistics' term. Require a header or the enrollment intro.
            if pattern is SEMESTER_ONLY and not (standalone or m.end() <= intro_end and enrollment):
                continue
            matches.append(m)
            if m.end() <= intro_end and (standalone or enrollment):
                global_matches.append(m)
    matches.sort(key=lambda m: m.start())
    local = [m for m in matches if paragraph[0] <= m.start() and m.end() <= position]
    applicable = []
    for m in local:
        line_start = text.rfind("\n", 0, m.start()) + 1
        line_end = text.find("\n", m.end())
        line_end = len(text) if line_end < 0 else line_end
        inline_assessment = UNIT.search(text[line_start:line_end])
        anchor_position = unit["start"] if unit else position
        if not inline_assessment or line_start <= anchor_position < line_end:
            applicable.append(m)
    # The last inline date starts a new local block, not a conflicting value
    # on an earlier same-kind exam. Keep its resolved term in the record key.
    chosen = applicable[-1:] or [m for m in global_matches if m.end() <= position]
    if len({m.group() for m in chosen}) == 1:
        m = chosen[0]
        raw = re.sub(r"\s", "", m["semester"])
        semester = 1 if raw == "1학기" else 3 if raw == "2학기" else 2 if raw.startswith("여름") else 4
        year = int(m["year"]) if "year" in m.groupdict() else None
        return year, semester, [evidence(text, m.start(), m.end(), "explicit_term" if year else "explicit_semester", field="term")], []
    reasons = ["ambiguous_term"] if chosen or SHORT_TERM.search(text[paragraph[0]:position]) else []
    return None, None, [], reasons


def extract_comment(comment):
    text = comment.text
    records = {}
    handled = []
    personal = []
    non_score = []
    for pattern in (PERSONAL_Q, OFFSET, PERSONAL_FULL):
        for m in pattern.finditer(text):
            handled.append((m.start(), m.end()))
            personal.append(evidence(text, m.start(), m.end(), "explicit_personal_expression"))

    def covered(a, b):
        return any(x <= a and b <= y for x, y in handled)

    for pindex, (pa, pb) in enumerate(_paragraphs(text)):
        paragraph = text[pa:pb]
        paragraph_units = [_unit(m, pa) for m in UNIT.finditer(paragraph)]
        last_heading = None
        inherited_component = None
        for line_match in re.finditer(r"[^\r\n]+", paragraph):
            la, lb = pa + line_match.start(), pa + line_match.end()
            line = text[la:lb]
            units = []
            for u in paragraph_units:
                if not la <= u["start"] < lb:
                    continue
                if u["raw_label"] == "시험" and units and units[-1]["kind"] in ("midterm", "final") and not text[units[-1]["end"]:u["start"]].strip():
                    continue
                role = _mention_role(u, line, la)
                if role == "reference":
                    continue
                if role == "ambiguous":
                    anchor = next((known for known in reversed(units) if not known.get("ambiguous")), last_heading)
                    if anchor and (anchor["kind"], anchor["number"]) == (u["kind"], u["number"]):
                        continue
                    u = {**u, "kind": None, "number": None, "ambiguous": True}
                units.append(u)
            if units:
                inherited_component = None
            # A new paragraph never borrows the previous paragraph's assessment.
            if units and re.match(r"^\s*(?:\(?\d+[.)]\s*)?(?:중간|기말|퀴즈|과제|HW|시험|프로젝트|플젝|\d+차)", line, re.I):
                last_heading = units[0]

            def targets(position):
                before = [u for u in units if u["end"] <= position]
                unit = before[-1] if before else last_heading
                joint = []
                if len(before) >= 2:
                    u, v = before[-2:]
                    between = text[u["end"]:v["start"]]
                    if {u["kind"], v["kind"]} == {"midterm", "final"} and re.fullmatch(r"[\s/·,+]*(?:(?:및|과|와|이랑|고)[\s/·,+]*)?", between):
                        joint = [u, v]
                if (not before or unit["kind"] == "exam" and unit["number"] is None) and re.search(r"둘\s*다|모두", text[max(la, position-35):position]):
                    after = [u for u in units if u["start"] >= position and u["kind"] in ("midterm", "final")]
                    if {u["kind"] for u in after} == {"midterm", "final"}:
                        joint = [next(u for u in after if u["kind"] == k) for k in ("midterm", "final")]
                return joint or [unit]

            def get_record(position, unit):
                component = None
                component_span = None
                # Only explicit local component context; new exam anchors reset it.
                boundary = max(la, unit["end"] if unit and unit["end"] <= position else la)
                part_matches = list(PART.finditer(text[boundary:position]))
                if part_matches:
                    pm = part_matches[-1]
                    tail = text[boundary+pm.end():position]
                    if len(tail) <= 95 and not re.search(r"문제.*(?:나옵|출제|그래서)|통계량", tail):
                        component = None if pm.group() == "전체" else pm.group()
                        component_span = (boundary+pm.start(), boundary+pm.end())
                elif not units and inherited_component:
                    component, component_span = inherited_component
                scope = "section" if component else "composite" if unit and unit["composite"] else "whole" if unit and unit["kind"] else "unknown"
                kind = unit["kind"] if unit else None
                number = unit["number"] if unit else None
                year, semester, term_ev, reasons = _term(text, (pa, pb), position, unit)
                key = (pindex, kind, number, scope, component, year, semester)
                if key not in records:
                    rec = {
                        "schema_version": SCHEMA_VERSION, "rule_version": RULE_VERSION,
                        "record_id": digest(f"{comment.file_sha256}:{comment.pointer}:{key}".encode())[:24],
                        "course_title": comment.title, "instructor": comment.instructor,
                        "assessment": {"kind": kind, "number": number, "raw_label": unit["raw_label"] if unit else None},
                        "scope": scope, "component": component, "year": year, "semester": semester,
                        "statistics": dict.fromkeys(FIELDS), "observed_max": None,
                        "source": comment.source(), "evidence": [], "candidates": [],
                        "context_evidence": term_ev, "review_reasons": reasons, "xlsx_refs": [],
                        "_conflicts": set(),
                    }
                    records[key] = rec
                rec = records[key]
                if unit:
                    ev = evidence(text, unit["start"], unit["end"], "assessment_label", field="assessment")
                    if ev not in rec["context_evidence"]:
                        rec["context_evidence"].append(ev)
                if component_span:
                    ca, cb = component_span
                    ev = evidence(text, ca, cb, "component_label", field="scope")
                    if ev not in rec["context_evidence"]:
                        rec["context_evidence"].append(ev)
                return rec

            def candidate(a, b, reason, unit_targets=None, **extra):
                for unit in unit_targets if unit_targets is not None else targets(a):
                    rec = get_record(a, unit)
                    ev = evidence(text, a, min(b, lb), reason, **extra)
                    if ev not in rec["candidates"]:
                        rec["candidates"].append(ev)
                    rec["review_reasons"].append(reason)
                handled.append((a, min(b, lb)))

            def add(a, b, field, raw, rule, unit_targets=None, **extra):
                value = _number(raw)
                for unit in unit_targets if unit_targets is not None else targets(a):
                    rec = get_record(a, unit)
                    container = rec if field == "observed_max" else rec["statistics"]
                    prior = container[field]
                    rec["evidence"].append(evidence(text, a, b, rule, field=field, value=value, value_text=raw, **extra))
                    if field in rec["_conflicts"]:
                        continue
                    if prior is not None and prior != value:
                        container[field] = None
                        rec["_conflicts"].add(field)
                        rec["review_reasons"].append("conflicting_values")
                    else:
                        container[field] = value
                handled.append((a, b))

            population_spans = []
            for m in LABEL.finditer(line):
                a = la + m.start()
                if covered(a, la + m.end()):
                    continue
                following = line[m.end():]
                n = NUMBER_AFTER.match(following)
                if not n:
                    # Bare personal quartile rankings must not become numeric values.
                    if m["q"] and re.match(r"\s*(?:[,/\n]|기말|중간|로|정도|$)", following) and re.search(r"(?:A[+0-]|에쁠|에제|받아|받았)", line) and not re.search(r"통계량|각각|q[1-4]\s*[:=]", line, re.I):
                        handled.append((a, la+m.end()))
                        personal.append(evidence(text, a, la+m.end(), "personal_quartile_rank"))
                    continue
                b = la + m.end() + n.end()
                raw = n["num"]
                field = re.sub(r"\s", "", m["q"].lower()) if m["q"] else "average" if m["average"] else "q2" if m["median"] else "observed_max"
                tail = text[b:min(lb, b+65)]
                prefix = text[max(la, a-20):a]
                if re.match(r"[,.]\d", tail):
                    candidate(a, min(lb, b+25), "unsupported_number_format")
                    continue
                hypothesis = HYPOTHETICAL_TAIL.match(tail)
                uncertainty = UNCERTAIN_TAIL.match(tail)
                if hypothesis or re.search(r"만약|가정하|만점\s*일\s*때", prefix):
                    candidate(a, b+hypothesis.end() if hypothesis else min(lb, b+30), "hypothetical_value", field=field, value=_number(raw), value_text=raw, qualifier=hypothesis.group() if hypothesis else prefix)
                    continue
                if uncertainty:
                    candidate(a, b+uncertainty.end(), "uncertain_value", field=field, value=_number(raw), value_text=raw, qualifier=uncertainty.group())
                    continue
                selected = targets(a)
                tabular = not line[:m.start()].strip() or bool(re.search(r"통계량|점수|성적", prefix))
                # Parenthesized population figures immediately after a points
                # fraction are a score table even when the exam name is absent.
                tabular = tabular or any(re.fullmatch(r"\s*[,;(（]?\s*", text[la+ratio.end():a]) for ratio in RATIO.finditer(line[:m.start()]))
                state, basis = classify_quantity(prefix, tail, has_assessment=any(u and (u["kind"] or u["composite"]) for u in selected), tabular_label=tabular, field=field)
                if state == "non_score":
                    handled.append((a, b))
                    non_score.append(evidence(text, a, min(lb, b+15), "non_score_unit", field=field, value=_number(raw), unit_state=state, quantity_dimension=basis))
                    continue
                if state == "unresolved":
                    candidate(a, min(lb, b+45), basis, field=field, value=_number(raw), value_text=raw, unit_state=state)
                    continue
                if re.match(r"\s*점?\s*만점", tail) and not re.match(r"\s*만점\s*(?:은|는|이|가|[:=：])?\s*\d", tail):
                    candidate(a, min(lb, b+40), "unsupported_stat_expression")
                    continue
                qualifier_tail = re.sub(r"^\s*/\s*" + NUM, "", tail)
                if APPROXIMATE_TAIL.match(qualifier_tail) or re.search(r"대충|약\s*$", prefix):
                    candidate(a, min(lb, b+25), "approximate_value")
                    continue
                if re.match(r"(?:\s+|\s*[,;]\s*)\d+(?:\.\d+)?", tail) and not re.match(r"(?:\s+|\s*[,;]\s*)\d+(?:\.\d+)?\s*점?\s*만점", tail):
                    candidate(a, min(lb, b+30), "multiple_unlabelled_values")
                    continue
                clause = re.split(r"[/,;]|(?<!\d)\.(?!\d)", line[:m.start()])[-1]
                explicit_prior_mean = bool(LABEL.search(clause))
                personal_pronoun = re.search(r"(?<![가-힣A-Za-z0-9])(?:제|내|개인)\s*(?:점수\s*)?$", prefix)
                personal_assignment = re.search(r"(?:^|\s)(?:저는|제가|나는|내가)\s*(?:과제|HW|assignment)(?:는|은|의)?\s*$", clause, re.I)
                combined_personal = not explicit_prior_mean and re.search(r"(?:중간|기말).*(?:과제|기말)", clause) and re.search(r"망했|받았|받아|b\+|a\+", line[m.end():], re.I)
                if field == "average" and (personal_pronoun or personal_assignment or combined_personal):
                    candidate(a, b, "personal_or_composite_average")
                    continue
                add(a, b, field, raw, "explicit_stat_label", unit_state="score", unit_basis=basis)
                population_spans.append((a, b))

            for m in MAXIMUM.finditer(line):
                a, b = la+m.start(), la+m.end()
                if any(e["start"] <= a and b <= e["end"] for e in personal) or any(u["start"] <= a < u["end"] for u in units):
                    continue
                if re.match(r"[,.]\d", text[b:lb]):
                    candidate(a, min(lb, b+25), "unsupported_number_format")
                    continue
                if re.match(r"\s*(?:일\s*때|(?:이?라고|이라)?\s*가정)", text[b:lb]):
                    candidate(a, min(lb, b+35), "hypothetical_value")
                    continue
                if re.match(r"\s*(?:%|퍼센트)", text[b:lb]):
                    candidate(a, min(lb, b+20), "unsupported_score_unit")
                    continue
                if APPROXIMATE_TAIL.match(text[b:lb]) or re.search(r"(?:약|대충)\s*$", text[max(la,a-10):a]):
                    candidate(a, min(lb,b+20), "approximate_value")
                    continue
                if re.search(r"환산|보너스", text[max(la, a-15):min(lb, b+25)]):
                    candidate(a, b, "rescaled_or_bonus_score")
                    continue
                add(a, b, "max_score", m["before"] or m["after"], "explicit_maximum_possible")

            # Ratios only supply a denominator when an independently labelled
            # population statistic is present in the same assessment segment.
            for m in RATIO.finditer(line):
                a, b = la+m.start(), la+m.end()
                if re.match(r"\s*(?:등|명|위|순위|%|퍼센트|문제|개|회)", text[b:lb]):
                    continue
                own_targets = targets(a)
                target_keys = {(u["kind"], u["number"]) if u else (None, None) for u in own_targets}
                linked = any(
                    abs(sa-a) < 90 and target_keys == {(u["kind"], u["number"]) if u else (None, None) for u in targets(sa)}
                    for sa, sb in population_spans
                )
                if linked:
                    add(a, b, "max_score", m["max"], "score_denominator_with_population_stat", own_targets)

            # Every remaining marker is explicitly represented for review.
            # No match is not evidence of "no statistics".
            if units or last_heading:
                for m in UNLABELLED_TUPLE.finditer(line):
                    a, b = la+m.start(), la+m.end()
                    if not covered(a, b):
                        candidate(a, b, "unsupported_stat_expression")
            for m in MARKER.finditer(line):
                a, b = la+m.start(), la+m.end()
                if covered(a, b):
                    continue
                # Minimum is deliberately not a requested field; retain it as
                # an unsupported candidate rather than relabeling it as Q1.
                candidate(a, min(lb, b+50), "unsupported_stat_expression")
            if last_heading:
                boundary = max(la, units[-1]["end"] if units else la)
                parts = list(PART.finditer(text[boundary:lb]))
                if parts and (not units or len(units) == 1):
                    pm = parts[-1]
                    inherited_component = (None if pm.group() == "전체" else pm.group(), (boundary+pm.start(), boundary+pm.end()))
            if len({(u["kind"], u["number"]) for u in units}) > 1:
                # A later bare statistic must not inherit the first of multiple
                # mentioned assessments. Keep its identity unresolved instead.
                last_heading = None
                inherited_component = None

    result = list(records.values())
    for rec in result:
        del rec["_conflicts"]
        validate_record(rec)
        check_evidence(rec, text)
    classification = "review_required" if any(r["status"] == "review_required" for r in result) else "accepted" if result else "excluded"
    excluded = None
    if not result:
        excluded = {
            "schema_version": SCHEMA_VERSION, "rule_version": RULE_VERSION,
            "source": comment.source(), "course_title": comment.title, "instructor": comment.instructor,
            "status": "excluded", "reason": "explicit_non_score_only" if non_score and not personal else "explicit_personal_only" if personal and not non_score else "explicit_non_score_or_personal_only" if personal else "no_statistic_marker",
            "evidence": personal + non_score,
        }
        for ev in personal + non_score:
            assert text[ev["start"]:ev["end"]] == ev["text"]
    return {"classification": classification, "records": result, "excluded": excluded, "non_score_evidence": non_score}
