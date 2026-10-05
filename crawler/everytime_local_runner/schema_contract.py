"""Reviewed contract for the user-selected root schema.sql; never executes SQL.

The neutral extractor and immutable raw archives are independent of this mapping.
A changed SQL file requires a new review instead of silently applying stale rules.
"""
from pathlib import Path
import os

from crawler.everytime_collect.run_v2 import require
from .storage import sha

SCHEMA_FILE = Path(os.environ.get('EVERYTIME_SCHEMA_FILE', str(Path(__file__).with_name('schema.sql'))))
SCHEMA_SHA256 = 'ca92b1ad96e93bc68f4606142b778183c01076b49adb27a274b638fb569ca963'
SCHEMA_PROFILE = 'root_course_assessments_v1'
ASSESSMENT_LABELS = ('중간', '기말', '1차', '2차', '3차', '퀴즈', '과제', '기타')


def verify_schema(path=None):
    path = Path(path) if path is not None else SCHEMA_FILE
    require(path.is_file() and sha(path) == SCHEMA_SHA256,
            'Selected root schema.sql changed or missing; review schema contract before generating candidates')
    return {str(path.resolve()): SCHEMA_SHA256}


def assessment_projection(assessment):
    """Map only exact supported identities; never collapse numbered observations."""
    kind, number = assessment['kind'], assessment['number']
    labels = {'midterm': '중간', 'final': '기말', 'quiz': '퀴즈', 'assignment': '과제', 'other': '기타'}
    reasons = []
    if kind == 'exam':
        label = f'{number}차' if type(number) is int and 1 <= number <= 3 else None
    elif kind in labels and number is None:
        label = labels[kind]
    else:
        label = None
    if label is None:
        reasons.append('database_assessment_unresolved_or_invalid')
        if kind in labels and number is not None:
            reasons.append('database_assessment_sequence_not_representable')
        elif kind == 'exam' and number is not None:
            reasons.append('database_assessment_type_outside_closed_vocabulary')
    return label, reasons
