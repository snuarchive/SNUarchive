import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { S, Term } from "./types";

export interface CatalogCourse {
  id: number;
  title: string;
  instructor: string;
  identityKey: string;
  /** Every department the course was offered under, sorted. */
  departments: string[];
  /** Newest first. */
  offerings: S<"Offering">[];
  latestTerm: Term;
  titleNorm: string;
  /** Normalized title, instructor and departments joined by a separator no token can contain. */
  searchText: string;
  listed: boolean;
}

export interface Catalog {
  courses: CatalogCourse[];
  byId: Map<number, CatalogCourse>;
  sourceLabel: string;
  offeringsTotal: number;
  sectionsTotal: number;
  /** Changes when the source files change; feeds the search ETag. */
  version: string;
}

interface SourceRow {
  course_title: string;
  instructor: string | null;
  course_number: string;
  lecture_number: string;
  department: string;
  year: number;
  semester: number;
}

export const PLACEHOLDER_INSTRUCTOR = "미정";
const SEP = "\u0001";

/** Lower-case, NFC, every whitespace character removed. */
export function normalize(s: string): string {
  return s.normalize("NFC").toLowerCase().replace(/\s+/gu, "");
}

/**
 * Temporary identity rule (backend design O9): normalized `title|instructor`.
 * A course with no instructor also keys on its department, so unrelated
 * '미정' sections of the same title do not merge.
 */
export function identityKey(
  title: string,
  instructor: string,
  department: string,
): string {
  const key = `${normalize(title)}|${normalize(instructor)}`;
  return instructor === PLACEHOLDER_INSTRUCTOR
    ? `${key}|${normalize(department)}`
    : key;
}

const SOURCE_FILE = /^(\d{4})-([1-4])\.json$/;

const cache = new Map<string, Catalog>();

export function loadCatalog(dir: string): Catalog {
  const hit = cache.get(dir);
  if (hit) return hit;
  const catalog = buildCatalog(dir);
  cache.set(dir, catalog);
  return catalog;
}

function buildCatalog(dir: string): Catalog {
  const files = readdirSync(dir)
    .filter((f) => SOURCE_FILE.test(f))
    .sort();
  if (!files.length)
    throw new Error(`No catalog source files (YYYY-S.json) found in ${dir}`);

  interface Acc {
    key: string;
    title: string;
    instructor: string;
    titleTerm: number;
    departments: Set<string>;
    offerings: Map<string, S<"Offering">>;
  }
  const byKey = new Map<string, Acc>();
  const sections = new Set<string>();
  const hash = createHash("sha1");

  for (const file of files) {
    const [, y, s] = SOURCE_FILE.exec(file)!;
    const fileYear = Number(y);
    const fileSemester = Number(s) as Term["semester"];
    const raw = readFileSync(join(dir, file), "utf8");
    hash.update(file).update(raw);
    const rows = JSON.parse(raw) as SourceRow[];
    for (const row of rows) {
      const title = String(row.course_title ?? "").trim();
      if (!title) continue;
      const instructor =
        String(row.instructor ?? "").trim() || PLACEHOLDER_INSTRUCTOR;
      const department = String(row.department ?? "").trim();
      // The filename is authoritative for the term.
      const year = fileYear;
      const semester = fileSemester;
      const key = identityKey(title, instructor, department);
      const termOrder = year * 10 + semester;
      let acc = byKey.get(key);
      if (!acc) {
        acc = {
          key,
          title,
          instructor,
          titleTerm: termOrder,
          departments: new Set(),
          offerings: new Map(),
        };
        byKey.set(key, acc);
      } else if (termOrder > acc.titleTerm) {
        // Display the spelling from the newest offering.
        acc.title = title;
        acc.instructor = instructor;
        acc.titleTerm = termOrder;
      }
      if (department) {
        acc.departments.add(department);
        acc.offerings.set(`${year}-${semester}-${department}`, {
          year,
          semester,
          department,
        });
      }
      sections.add(
        `${year}-${semester}-${row.course_number}-${row.lecture_number}`,
      );
    }
  }

  const keys = [...byKey.keys()].sort(cmpStr);
  const courses: CatalogCourse[] = keys.map((key, i) => {
    const acc = byKey.get(key)!;
    const departments = [...acc.departments].sort(cmpStr);
    const offerings = [...acc.offerings.values()].sort(
      (a, b) =>
        b.year - a.year ||
        b.semester - a.semester ||
        cmpStr(a.department, b.department),
    );
    const latest = offerings[0] ?? {
      year: Math.floor(acc.titleTerm / 10),
      semester: acc.titleTerm % 10,
    };
    return {
      id: i + 1,
      title: acc.title,
      instructor: acc.instructor,
      identityKey: key,
      departments,
      offerings,
      latestTerm: {
        year: latest.year,
        semester: latest.semester as Term["semester"],
      },
      titleNorm: normalize(acc.title),
      searchText: [acc.title, acc.instructor, ...departments]
        .map(normalize)
        .join(SEP),
      listed: true,
    };
  });

  const offeringsTotal = courses.reduce((n, c) => n + c.offerings.length, 0);
  const first = files[0].replace(".json", "");
  const last = files[files.length - 1].replace(".json", "");
  return {
    courses,
    byId: new Map(courses.map((c) => [c.id, c])),
    sourceLabel: `${first} … ${last}`,
    offeringsTotal,
    sectionsTotal: sections.size,
    version: hash.digest("hex").slice(0, 12),
  };
}

export function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function termValue(t: Term): number {
  return t.year * 10 + t.semester;
}

/**
 * Every whitespace-separated token must be a substring of the course's
 * search text. Ordered by: title starts with the first token, latest
 * offering (desc), title, id.
 */
export function searchCatalog(catalog: Catalog, q: string): CatalogCourse[] {
  const tokens = q.split(/\s+/u).map(normalize).filter(Boolean);
  if (!tokens.length) return [];
  const first = tokens[0];
  const hits = catalog.courses.filter(
    (c) => c.listed && tokens.every((t) => c.searchText.includes(t)),
  );
  return hits.sort((a, b) => {
    const pa = a.titleNorm.startsWith(first) ? 0 : 1;
    const pb = b.titleNorm.startsWith(first) ? 0 : 1;
    return (
      pa - pb ||
      termValue(b.latestTerm) - termValue(a.latestTerm) ||
      cmpStr(a.title, b.title) ||
      a.id - b.id
    );
  });
}
