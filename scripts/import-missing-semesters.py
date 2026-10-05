"""Add audited XLS semesters without replacing any original semester JSON.

Requires xlrd==2.0.2. Reads originals; emits exclusive-create JSON supplements.
Run: python scripts/import-missing-semesters.py --audit-dir PATH
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

import xlrd

ROOT = Path(__file__).resolve().parents[1]
TERMS = {"1학기": 1, "여름학기": 2, "2학기": 3, "겨울학기": 4}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def clean(value):
    return re.sub(r"\s+", " ", str(value)).strip()


def read_source(path):
    sheet = xlrd.open_workbook(str(path)).sheet_by_index(0)
    match = re.search(r"년도\s*:\s*(20\d{2})학년도,\s*학기\s*:\s*([^,]+)", sheet.cell_value(1, 0))
    if not match or match[2].strip() not in TERMS:
        raise ValueError(f"Unrecognized term header: {path.name}")
    year, semester = int(match[1]), TERMS[match[2].strip()]
    headers = [clean(v) for v in sheet.row_values(2)]
    records = []
    for row in range(3, sheet.nrows):
        values = dict(zip(headers, sheet.row_values(row)))
        if not any(values.values()):
            continue
        if values['개설상태'] != '설강':
            raise ValueError(f"Unexpected offering status: {path.name}:{row + 1}")
        title, subtitle = clean(values['교과목명']), clean(values['부제명'])
        if not title:
            raise ValueError(f"Missing title: {path.name}:{row + 1}")
        records.append(dict(course_title=title + (f" ({subtitle})" if subtitle else ""),
            instructor=clean(values['주담당교수']) or '미정',
            department=clean(values['개설학과']) or '미분류',
            course_number=clean(values['교과목번호']), lecture_number=clean(values['강좌번호']),
            year=year, semester=semester,
            source_file=path.name, source_sheet=sheet.name, source_row=row + 1))
    return year, semester, records


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--audit-dir', type=Path, required=True)
    args = parser.parse_args()
    audit = json.loads((args.audit_dir / 'report.json').read_text(encoding='utf-8-sig'))
    conclusion = json.loads((args.audit_dir / 'conclusion.json').read_text(encoding='utf-8-sig'))
    missing = set(conclusion['missing_semesters'])
    selected = {(r['file'], r['excel_row']) for r in conclusion['included_semester_section_rows_missing']}
    planned, sources = {}, []
    for source, checksum in audit['sources'].items():
        path = Path(source)
        if path.suffix != '.xls':
            continue
        if sha(path) != checksum:
            raise ValueError(f"Source changed since audit: {path.name}")
        year, semester, rows = read_source(path)
        include = rows if path.name in missing else [r for r in rows if (path.name, r['source_row']) in selected]
        if not include:
            continue
        original = ROOT / f'{year}-{semester}.json'
        if path.name in missing and original.exists():
            raise ValueError(f"Semester already exists: {original.name}")
        if original.exists():
            existing = json.loads(original.read_text(encoding='utf-8-sig'))
            keys = {(r['course_number'], r['lecture_number']) for r in existing}
            assert all((r['course_number'], r['lecture_number']) not in keys for r in include)
        name = f'{year}-{semester}.json'
        if name in planned:
            raise ValueError(f'Duplicate semester source: {name}')
        planned[name] = include
        sources.append(dict(file=path.name, sha256=checksum, total_rows=len(rows), imported_rows=len(include), output=name))
    assert len(planned) == 15 and sum(map(len, planned.values())) == 55369
    destination = ROOT / 'data' / 'course-supplements'
    outputs = [destination / name for name in planned] + [destination / 'manifest.json']
    if any(p.exists() for p in outputs):
        raise FileExistsError('Refusing to overwrite an existing supplement or manifest')
    destination.mkdir(parents=True, exist_ok=True)
    for name, rows in planned.items():
        with (destination / name).open('x', encoding='utf-8', newline='\n') as f:
            json.dump(rows, f, ensure_ascii=False, separators=(',', ':'))
    manifest = dict(sources=sources, imported_rows=55369, missing_semesters=14,
        supplemental_sections=6, semester_codes=TERMS,
        policy='Additive only. Original inputs and ambiguous label variants are not replaced.',
        outputs={p.name: sha(p) for p in outputs[:-1]})
    with outputs[-1].open('x', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(json.dumps(dict(files=len(planned), rows=manifest['imported_rows']), ensure_ascii=False))


if __name__ == '__main__':
    main()
