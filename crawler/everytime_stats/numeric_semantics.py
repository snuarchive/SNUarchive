"""Abstention guards for expressions confirmed in followup_A.

These rules never infer a number, assessment, or date. Offsets refer to the
unchanged original text; a rejected exact value keeps its qualifier as evidence.
"""
import re

MALFORMED = re.compile(r'(?:\.[xX?]+|[xX?]+)')
MALFORMED_MAX = re.compile(r'(?<![\w.])\d+(?:\.[xX?]+|[xX?]+)\s*점?\s*만점')
BOUND = re.compile(r'\s*점?\s*(?:(?:이|가)?\s*채\s*(?:안\s*되|되지\s*않)|보다\s*(?:조금|약간|좀)?\s*(?:높|낮)|초과)')
DECADE = re.compile(r'\s*점?\s*(?:초중반|중후반|초반|중반|후반)대?')
QUESTION = re.compile(r'(?:한|모든|각|개별)\s*문제(?:는|가|의)?\s*(?:평균(?:이|은)?\s*)?$')
ADJUSTED_BOUNDS = re.compile(r'난이도\s*보정.{0,30}만점(?:을|이)?\s*내리')
AGGREGATE = re.compile(r'\d+(?:\.\d+)?점\s*중\s*출석\s*\d+(?:\.\d+)?\s*(?:프로|퍼센트|%)\s*제외한\s*나머지\s*$')


def numeric_guard(text, start, number_end, end, line_start, line_end):
    """Reject only qualifiers adjacent to the number, not other fields nearby."""
    tail = text[number_end:line_end]
    for pattern, reason in ((MALFORMED, 'malformed_numeric'), (BOUND, 'approximate_or_bound'),
                            (DECADE, 'approximate_or_bound')):
        m = pattern.match(tail)
        if m:
            return start, max(end, number_end + m.end()), reason
    return None


def maximum_guard(text, start, end, line_start, line_end):
    prefix, tail = text[line_start:start], text[end:line_end]
    alternative = re.search(r'\d+(?:\.\d+)?\s*점?\s*인가\s*$', prefix)
    if alternative:
        return line_start + alternative.start(), end, 'uncertain_value'
    question = QUESTION.search(prefix)
    if question:
        return line_start + question.start(), end, 'question_level_maximum'
    converted = re.match(r'\s*(?:으로\s*)?변환\s*시', tail)
    if converted:
        return start, end + converted.end(), 'score_scale_ambiguous'
    hypothetical = re.match(r'\s*(?:이라|이라고|라|으로)?\s*(?:치면|가정)', tail)
    if hypothetical:
        return start, end + hypothetical.end(), 'hypothetical_value'
    if ADJUSTED_BOUNDS.search(text[line_start:line_end]):
        return line_start, line_end, 'score_scale_ambiguous'
    return None


def parentheses(text):
    stack, ranges = [], []
    for index, char in enumerate(text):
        if char in '(（':
            stack.append(index)
        elif char in ')）' and stack:
            ranges.append((stack.pop(), index + 1))
    # Only the confirmed explanatory-parenthesis family. General bracket
    # attribution would also rewrite unrelated historical/table structures.
    return [(a, b) for a, b in ranges if re.search(
        r'(?:중간(?:고사)?|기말(?:고사)?)\s*[1-6]?에서.{0,90}오채점', text[a:b])]


def same_parenthetical_scope(anchor, position, ranges):
    # A reference inside a closed explanatory clause cannot replace its anchor.
    return all(a <= position < b for a, b in ranges if a < anchor < b)


def component_context(tail):
    if re.match(r'\s*(?:은|는|이|가)?\s*없', tail):
        return 'negated'
    if re.match(r'\s*문제들이\s*모두\s*고르시오', tail):
        return 'descriptive'
    return 'local'
