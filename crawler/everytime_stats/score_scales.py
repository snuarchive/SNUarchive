"""Abstain on the confirmed paired-scale defect and its named variants.

This is not a score normalizer. It never computes or chooses a converted value.
One evidence packet replaces linked observations; every original record and
Unicode span survives in metadata. Other explicitly named exams stay separate.
"""
from copy import deepcopy
import re

from .models import ALL_FIELDS, FIELDS, digest, evidence
from .validate import check_evidence, validate_record

CONVERSION = re.compile(
    r"환산하면|배점\s*변환|\d+(?:\.\d+)?\s*점(?:으로)?\s*환산"
    r"|기본\s*점수[^\n.!?]{0,60}?(?:빼면|차감|제외|스케일)"
)
POPULATION = {'q1', 'q2', 'q3', 'q4', 'average', 'observed_max'}


def _paragraph(text, position):
    breaks = list(re.finditer(r'\r?\n[ \t]*\r?\n', text))
    return (max([b.end() for b in breaks if b.end() <= position] or [0]),
            min([b.start() for b in breaks if b.start() > position] or [len(text)]))


def hold_ambiguous_scales(records, text):
    numeric_evidence = [(i, e) for i, r in enumerate(records) for e in r['evidence'] + r['candidates']
                        if e.get('field') in ALL_FIELDS and e.get('value') is not None]
    groups = []
    for marker in CONVERSION.finditer(text):
        clause_prefix = re.split(r'(?<!\d)[.!?](?!\d)|\n', text[:marker.start()])[-1]
        if re.search(r'(?:제|내|본인|저는|나는)\s*(?:원점수|점수)', clause_prefix):
            continue
        pa, pb = _paragraph(text, marker.start())
        # A transformation mention alone or a personal score never creates a
        # population observation. Require an already recognized labelled value
        # after it (accepted evidence or an abstained value, never a bare number).
        following = sorted([(i, e) for i, e in numeric_evidence
                            if e['field'] in POPULATION and marker.end() <= e['start'] <= marker.end() + 300],
                           key=lambda pair: pair[1]['start'])
        if not following:
            continue
        right, first = following[0]
        # Across a blank line only the immediately following statistics table
        # is linked. Do not walk into an unrelated later narrative paragraph.
        if first['start'] >= pb and text[pb:first['start']].strip():
            continue
        key = (records[right]['assessment']['kind'], records[right]['assessment']['number'])
        if key[0] is None:
            # An unlabelled converted table cannot absorb every named exam in
            # the paragraph. Bound it by the nearest explicit observation.
            local_known = [(i, e) for i, e in numeric_evidence if pa <= e['start'] <= first['start']
                           and records[i]['assessment']['kind'] is not None]
            previous_known = [(i, e) for i, e in numeric_evidence if marker.start() - 800 <= e['end'] <= marker.start()
                              and records[i]['assessment']['kind'] is not None]
            closest = (min(local_known, key=lambda pair: abs(pair[1]['start'] - marker.start()))
                       if local_known else max(previous_known, key=lambda pair: pair[1]['end']) if previous_known else None)
            if closest:
                anchor = records[closest[0]]['assessment']
                key = (anchor['kind'], anchor['number'])
        def compatible(i):
            other = (records[i]['assessment']['kind'], records[i]['assessment']['number'])
            return key[0] is None or other[0] is None or other == key
        selected = {right}
        # Include the possible maximum named in the transformation paragraph,
        # without touching a separately named midterm/final/numbered exam.
        selected.update(i for i, e in numeric_evidence if pa <= e['start'] < pb and compatible(i))
        preceding = sorted([(i, e) for i, e in numeric_evidence
                            if marker.start() - 800 <= e['end'] <= marker.start() and compatible(i)],
                           key=lambda pair: pair[1]['end'])
        if preceding:
            selected.add(preceding[-1][0])
        merged_markers = [(marker.start(), marker.end())]
        # Only overlapping evidence groups join; unrelated conversions do not.
        for prior in list(groups):
            if selected & prior[0]:
                selected |= prior[0]; merged_markers += prior[1]; groups.remove(prior)
        groups.append((selected, merged_markers))
    if not groups:
        return records
    replacement, removed = {}, set()
    for selected, markers in groups:
        originals = [deepcopy(records[i]) for i in sorted(selected)]
        rec = deepcopy(originals[0])
        identities = {(r['assessment']['kind'], r['assessment']['number'], r['scope'], r['component']) for r in originals}
        if len(identities) != 1:
            # This is a review packet, not an assertion of a shared assessment.
            rec['assessment'] = {'kind': None, 'number': None, 'raw_label': None}
            rec['scope'], rec['component'] = 'unknown', None
        for field in ('year', 'semester'):
            choices = {r[field] for r in originals}
            rec[field] = next(iter(choices)) if len(choices) == 1 else None
        rec['record_id'] = digest(('score_scale_hold:' + ':'.join(r['record_id'] for r in originals)).encode())[:24]
        rec['statistics'] = dict.fromkeys(FIELDS)
        rec['observed_max'] = None
        for bucket in ('evidence', 'candidates', 'context_evidence'):
            rec[bucket] = []
            for original in originals:
                for ev in original[bucket]:
                    if ev not in rec[bucket]:
                        rec[bucket].append(ev)
        marker_evidence = [evidence(text, a, b, 'paired_score_scale_conversion') for a, b in sorted(set(markers))]
        rec['context_evidence'] += marker_evidence
        rec['review_reasons'] = sorted({reason for r in originals for reason in r['review_reasons']} | {'score_scale_ambiguous'})
        rec['score_scale_note'] = {
            'rule': 'paired_score_scale_conversion', 'resolution': 'unresolved',
            'automatic_statistic_selection': False, 'evidence': marker_evidence,
            'observations': originals,
            'note': 'Linked scale observations withheld from numeric fields; no normalization or assumption of a common assessment.'}
        validate_record(rec)
        check_evidence(rec, text)
        replacement[min(selected)] = rec
        removed |= selected
    return [replacement[i] if i in replacement else r for i, r in enumerate(records) if i not in removed or i in replacement]
