// Deterministic example contributions, placed relative to the current time so
// open voting stays open and "this term" figures stay non-empty.
import type { CatalogCourse } from "./catalog";
import { DAY_MS, previousTerm, termAt, termStart } from "./calendar";
import type { Ctx } from "./domain";
import { iso } from "./domain";
import { barChartPng, textPdf } from "./files";
import { KIND } from "./refdata";
import type {
  CommentRow,
  Figures,
  LogRow,
  ReportRow,
  SittingRow,
  State,
  StatisticRow,
  UserRow,
  VoteRow,
  VotingRequestRow,
} from "./state";
import { emptyState, nextId } from "./state";
import type { ActivityAction, Term } from "./types";

const HOUR = 3600 * 1000;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Preferred seed courses, by exact title. The first twelve present are used.
const PREFERRED_TITLES = [
  "미적분학 1",
  "대학영어 1",
  "프로그래밍방법론",
  "선형대수학",
  "경제원론 1",
  "물리학 1",
  "화학 1",
  "생물학 1",
  "컴퓨터의 개념 및 실습",
  "대학 글쓰기 1",
  "통계학",
  "자료구조",
  "알고리즘",
  "미적분학 2",
  "대학영어 2",
  "심리학개론",
];

export function pickSeedCourses(
  courses: CatalogCourse[],
  n = 12,
): CatalogCourse[] {
  const termValue = (c: CatalogCourse) =>
    c.latestTerm.year * 10 + c.latestTerm.semester;
  const better = (a: CatalogCourse, b: CatalogCourse) =>
    b.offerings.length - a.offerings.length ||
    termValue(b) - termValue(a) ||
    a.id - b.id;
  const picked: CatalogCourse[] = [];
  for (const title of PREFERRED_TITLES) {
    const matches = courses.filter((c) => c.title === title).sort(better);
    if (matches[0]) picked.push(matches[0]);
    if (picked.length === n) return picked;
  }
  // Fall back to the most-offered courses so the seed works with any catalog.
  for (const c of [...courses].sort(better)) {
    if (picked.length === n) break;
    if (!picked.includes(c)) picked.push(c);
  }
  return picked;
}

interface SeedUser {
  email: string | null;
  name: string | null;
  college: string | null;
  year: number | null;
  dbAdmin?: boolean;
  createdDaysAgo: number;
  seenDaysAgo: number | null;
  deleted?: boolean;
}

const USERS: SeedUser[] = [
  {
    email: "admin@snu.ac.kr",
    name: "관리자",
    college: "공과대학",
    year: 2018,
    createdDaysAgo: 400,
    seenDaysAgo: 0,
  },
  {
    email: "student@snu.ac.kr",
    name: "김민수",
    college: "자연과학대학",
    year: 2023,
    createdDaysAgo: 300,
    seenDaysAgo: 0,
  },
  {
    email: "newbie@snu.ac.kr",
    name: "박새내",
    college: null,
    year: null,
    createdDaysAgo: 1,
    seenDaysAgo: 1,
  },
  {
    email: "moderator@snu.ac.kr",
    name: "이운영",
    college: "경영대학",
    year: 2020,
    dbAdmin: true,
    createdDaysAgo: 380,
    seenDaysAgo: 2,
  },
  {
    email: "2022-13579@snu.ac.kr",
    name: "최지훈",
    college: "인문대학",
    year: 2022,
    createdDaysAgo: 250,
    seenDaysAgo: 3,
  },
  {
    email: "seoyeon@snu.ac.kr",
    name: "정서연",
    college: "사회과학대학",
    year: 2021,
    createdDaysAgo: 240,
    seenDaysAgo: 5,
  },
  {
    email: "doyoon@snu.ac.kr",
    name: "강도윤",
    college: "공과대학",
    year: 2024,
    createdDaysAgo: 200,
    seenDaysAgo: 1,
  },
  {
    email: "haeun@snu.ac.kr",
    name: "조하은",
    college: "공과대학",
    year: 2023,
    createdDaysAgo: 190,
    seenDaysAgo: 8,
  },
  {
    email: "siwoo@snu.ac.kr",
    name: "윤시우",
    college: "경영대학",
    year: 2022,
    createdDaysAgo: 180,
    seenDaysAgo: 40,
  },
  {
    email: "yujin@snu.ac.kr",
    name: "장유진",
    college: "자연과학대학",
    year: 2025,
    createdDaysAgo: 170,
    seenDaysAgo: 2,
  },
  {
    email: "junho@snu.ac.kr",
    name: "임준호",
    college: "농업생명과학대학",
    year: 2021,
    createdDaysAgo: 160,
    seenDaysAgo: 90,
  },
  {
    email: "jimin@snu.ac.kr",
    name: "한지민",
    college: "사범대학",
    year: 2024,
    createdDaysAgo: 150,
    seenDaysAgo: 4,
  },
  {
    email: "sehun@snu.ac.kr",
    name: "오세훈",
    college: "공과대학",
    year: 2020,
    createdDaysAgo: 140,
    seenDaysAgo: 12,
  },
  {
    email: "yerin@snu.ac.kr",
    name: "서예린",
    college: "의과대학",
    year: 2023,
    createdDaysAgo: 130,
    seenDaysAgo: 6,
  },
  {
    email: "donghyun@snu.ac.kr",
    name: "신동현",
    college: "자유전공학부",
    year: 2025,
    createdDaysAgo: 120,
    seenDaysAgo: 3,
  },
  {
    email: "nayeon@snu.ac.kr",
    name: "권나연",
    college: "생활과학대학",
    year: 2022,
    createdDaysAgo: 110,
    seenDaysAgo: 60,
  },
  {
    email: "2026-10442@snu.ac.kr",
    name: "황민재",
    college: "공과대학",
    year: 2026,
    createdDaysAgo: 25,
    seenDaysAgo: 1,
  },
  {
    email: "subin@snu.ac.kr",
    name: "안수빈",
    college: "미술대학",
    year: 2024,
    createdDaysAgo: 100,
    seenDaysAgo: 9,
  },
  {
    email: "hyunwoo@snu.ac.kr",
    name: "송현우",
    college: "사회과학대학",
    year: 2023,
    createdDaysAgo: 90,
    seenDaysAgo: 15,
  },
  {
    email: "minsu.namgung@snu.ac.kr",
    name: "남궁민수",
    college: "인문대학",
    year: 2021,
    createdDaysAgo: 80,
    seenDaysAgo: 7,
  },
  {
    email: "haneul@snu.ac.kr",
    name: "유하늘",
    college: null,
    year: 2024,
    createdDaysAgo: 70,
    seenDaysAgo: 20,
  },
  {
    email: "gildong@snu.ac.kr",
    name: "홍길동",
    college: "대학원/기타",
    year: 2019,
    createdDaysAgo: 60,
    seenDaysAgo: 30,
  },
  {
    email: null,
    name: null,
    college: null,
    year: null,
    createdDaysAgo: 220,
    seenDaysAgo: null,
    deleted: true,
  },
];

export const SEED_ACCOUNTS = {
  admin: "admin@snu.ac.kr",
  student: "student@snu.ac.kr",
  newbie: "newbie@snu.ac.kr",
  moderator: "moderator@snu.ac.kr",
} as const;

const COMMENT_BODIES = [
  "중간고사 생각보다 어려웠어요",
  "과제 양이 많지만 도움이 됩니다",
  "교수님 설명이 친절해요",
  "퀴즈가 매주 있어서 부담",
  "기출 위주로 공부하면 됩니다",
  "출석 체크 엄격합니다",
  "시험 범위가 넓어요",
  "조교님이 정말 친절하세요",
  "팀플 없어서 좋았어요",
  "수업 속도가 빨라요",
  "연습문제 꼭 풀어보세요",
  "기말이 중간보다 쉬웠어요",
  "영어 발표 준비 필수",
  "코딩 과제 난이도 높음",
  "재밌는 수업이었어요",
  "추천합니다!",
  "시간 투자 많이 필요",
  "녹화 강의 제공돼서 편해요",
  "중간 평균 60점대",
  "교재 꼭 사세요",
  "질문 받아주셔서 좋아요",
  "마지막 과제가 제일 어려움",
  "시험 시간 부족했어요",
  "무난한 교양입니다",
  "증명 문제 비중이 커요",
  "매주 복습하면 따라갈 만해요",
];

const NICKNAMES = [
  "(익명)",
  "수학러버",
  "새내기",
  "공대생",
  "ㅇㅇ",
  "(익명)",
  "밤샘러",
  "(익명)",
];

export function seedState(ctx: Ctx): State {
  const state = emptyState();
  const now = ctx.now();
  const rng = mulberry32(20260927);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];
  const ago = (days: number, hours = 0) => now - days * DAY_MS - hours * HOUR;
  const ip = () =>
    `147.46.${Math.floor(rng() * 250) + 1}.${Math.floor(rng() * 250) + 1}`;

  const T = termAt(now);
  // The two most recent regular (spring/fall) terms before the current one.
  const regular: Term[] = [];
  for (let t = previousTerm(T); regular.length < 3; t = previousTerm(t)) {
    if (t.semester === 1 || t.semester === 3) regular.push(t);
  }
  const [R1, R2, R3] = regular;
  // A time comfortably inside a past term.
  const within = (t: Term, days: number) => termStart(t) + days * DAY_MS;

  const logs: Omit<LogRow, "id">[] = [];
  const addLog = (
    userId: number | null,
    action: ActivityAction,
    createdAt: number,
    metadata: Record<string, unknown> = {},
  ) =>
    logs.push({
      userId,
      action,
      metadata,
      ip: userId === null ? null : ip(),
      createdAt: Math.min(createdAt, now),
    });

  // ---------------------------------------------------------------- users
  const users: UserRow[] = USERS.map((u) => {
    const row: UserRow = {
      id: nextId(state, "users"),
      email: u.email,
      displayName: u.name,
      dbAdmin: !!u.dbAdmin,
      college: u.college,
      admissionYear: u.year,
      lastIp: u.deleted ? null : ip(),
      sessionEpoch: u.deleted ? 1 : 0,
      createdAt: ago(u.createdDaysAgo),
      lastSeenAt: u.seenDaysAgo === null ? null : ago(u.seenDaysAgo, 2),
      deletedAt: u.deleted ? ago(20) : null,
    };
    addLog(row.id, "login", row.createdAt, { email: u.email ?? undefined });
    if (u.seenDaysAgo !== null && u.seenDaysAgo < u.createdDaysAgo) {
      addLog(row.id, "login", ago(u.seenDaysAgo, 3), { email: u.email });
    }
    if (u.college)
      addLog(row.id, "profile_update", row.createdAt + HOUR, {
        college: u.college,
        admissionYear: u.year,
      });
    if (u.deleted) addLog(row.id, "account_delete", ago(20));
    return row;
  });
  state.users = users;
  const byEmail = (e: string) => users.find((u) => u.email === e)!;
  const admin = byEmail(SEED_ACCOUNTS.admin);
  const student = byEmail(SEED_ACCOUNTS.student);
  const moderator = byEmail(SEED_ACCOUNTS.moderator);
  const deletedUser = users.find((u) => u.deletedAt !== null)!;
  const crowd = users.filter((u) => u.deletedAt === null && u.id > 4); // ordinary students
  addLog(admin.id, "admin_grant", moderator.createdAt + DAY_MS, {
    userId: moderator.id,
  });

  // ------------------------------------------------------------- sittings
  const courses = pickSeedCourses(ctx.catalog.courses);
  const [C0, C1, C2, C3, C4, C5, C6, C7, C8, , C10, C11] = courses;

  const sitting = (
    course: CatalogCourse,
    kindId: number,
    number: number | null,
    t: Term,
    createdAt: number,
    voting: Partial<
      Pick<SittingRow, "votingOpenedAt" | "votingClosesAt" | "votingEndedAt">
    > = {},
  ): SittingRow => {
    const s: SittingRow = {
      id: nextId(state, "sittings"),
      courseId: course.id,
      kindId,
      number,
      year: t.year,
      semester: t.semester,
      votingOpenedAt: null,
      votingClosesAt: null,
      votingEndedAt: null,
      createdAt,
      ...voting,
    };
    state.sittings.push(s);
    if (s.votingOpenedAt !== null) {
      addLog(admin.id, "voting_open", s.votingOpenedAt, {
        sittingId: s.id,
        closesAt: iso(s.votingClosesAt),
      });
    }
    if (s.votingEndedAt !== null)
      addLog(moderator.id, "voting_close", s.votingEndedAt, {
        sittingId: s.id,
      });
    return s;
  };

  const r1Start = within(R1, 40);
  const r2Start = within(R2, 40);

  // Open, with a deadline three days out.
  const s1 = sitting(C0, KIND.midterm, null, T, ago(6), {
    votingOpenedAt: ago(2),
    votingClosesAt: now + 3 * DAY_MS,
  });
  const s2 = sitting(C0, KIND.final, null, R1, r1Start + 60 * DAY_MS, {
    votingOpenedAt: r1Start + 62 * DAY_MS,
    votingClosesAt: r1Start + 72 * DAY_MS,
    votingEndedAt: r1Start + 70 * DAY_MS,
  });
  // Closed because its deadline passed.
  const s3 = sitting(C0, KIND.midterm, null, R1, r1Start, {
    votingOpenedAt: r1Start + 2 * DAY_MS,
    votingClosesAt: r1Start + 12 * DAY_MS,
  });
  const s4 = sitting(C0, KIND.quiz, 3, R2, r2Start);
  // Open-ended.
  const s5 = sitting(C1, KIND.exam, 1, T, ago(8), {
    votingOpenedAt: ago(5),
    votingClosesAt: null,
  });
  const s6 = sitting(C1, KIND.exam, 2, T, ago(4));
  const s7 = sitting(C1, KIND.exam, 2, R1, r1Start + 50 * DAY_MS, {
    votingOpenedAt: r1Start + 52 * DAY_MS,
    votingClosesAt: r1Start + 60 * DAY_MS,
  });
  const s8 = sitting(C2, KIND.assignment, 2, T, ago(3));
  const s9 = sitting(C2, KIND.midterm, null, R1, r1Start + 5 * DAY_MS, {
    votingOpenedAt: r1Start + 6 * DAY_MS,
    votingClosesAt: null,
    votingEndedAt: r1Start + 20 * DAY_MS,
  });
  // Open, closing within 24 hours.
  const s10 = sitting(C2, KIND.quiz, 1, T, ago(2), {
    votingOpenedAt: ago(1),
    votingClosesAt: now + 20 * HOUR,
  });
  const s11 = sitting(C3, KIND.final, null, R1, r1Start + 70 * DAY_MS);
  const s12 = sitting(C3, KIND.midterm, null, T, ago(5));
  const s13 = sitting(C4, KIND.midterm, null, R2, r2Start + 3 * DAY_MS, {
    votingOpenedAt: r2Start + 4 * DAY_MS,
    votingClosesAt: r2Start + 14 * DAY_MS,
  });
  const s14 = sitting(C4, KIND.midterm, null, T, ago(4));
  const s15 = sitting(C5, KIND.final, null, R1, r1Start + 65 * DAY_MS);
  const s16 = sitting(C6, KIND.exam, 1, R2, r2Start + 10 * DAY_MS);
  const s17 = sitting(C7, KIND.midterm, null, R3, within(R3, 45));
  const s18 = sitting(C8, KIND.other, null, R1, r1Start + 30 * DAY_MS);
  const s19 = sitting(C10, KIND.final, null, R2, r2Start + 70 * DAY_MS);
  const s20 = sitting(C11, KIND.assignment, 1, T, ago(7));
  // C9 is left without sittings: an empty course page.

  for (const s of state.sittings) {
    addLog(admin.id, "sitting_create", s.createdAt, {
      sittingId: s.id,
      courseId: s.courseId,
    });
  }

  // ---------------------------------------------------------------- votes
  const castVotes = (s: SittingRow, weights: number[], voters: UserRow[]) => {
    const total = weights.reduce((a, b) => a + b, 0);
    let voter = 0;
    weights.forEach((count, i) => {
      for (let k = 0; k < count; k++) {
        const u = voters[voter++ % voters.length];
        const start = s.votingOpenedAt!;
        const end = Math.min(s.votingEndedAt ?? s.votingClosesAt ?? now, now);
        const at = start + Math.floor(((end - start) * (voter - 0.5)) / total);
        const v: VoteRow = {
          id: nextId(state, "votes"),
          sittingId: s.id,
          userId: u.id,
          rating: i + 1,
          createdAt: at,
          updatedAt: at,
        };
        state.votes.push(v);
        addLog(u.id, "vote_cast", at, { sittingId: s.id, rating: v.rating });
      }
    });
  };
  castVotes(s1, [1, 2, 5, 4, 2], [student, ...crowd]);
  castVotes(s2, [2, 4, 8, 6, 2], [student, ...crowd, moderator, admin]);
  castVotes(s3, [1, 3, 6, 5, 3], crowd);
  castVotes(s5, [0, 2, 3, 3, 1], crowd);
  castVotes(s7, [3, 5, 4, 1, 0], [student, ...crowd]);
  castVotes(s9, [0, 1, 3, 6, 5], crowd);
  castVotes(s10, [1, 1, 2, 1, 0], crowd.slice(3));
  castVotes(s13, [2, 3, 3, 2, 1], crowd.slice(1));

  // ----------------------------------------------------------- statistics
  const figures = (base: number, spread: number, max = 100): Figures => {
    const q1 = round1(base);
    const q2 = round1(base + spread);
    const q3 = round1(base + spread * 2);
    const q4 = round1(Math.min(max, base + spread * 3 + 5));
    return {
      q1,
      q2,
      q3,
      q4,
      average: round1(base + spread * 1.4),
      maxScore: max,
      note: null,
    };
  };
  const stat = (
    s: SittingRow,
    contributor: UserRow,
    f: Figures,
    createdAt: number,
    extra: Partial<StatisticRow> = {},
  ): StatisticRow => {
    const row: StatisticRow = {
      id: nextId(state, "statistics"),
      sittingId: s.id,
      contributorId: contributor.id,
      ...f,
      nickname: pick(NICKNAMES),
      source: "direct",
      sourceReportId: null,
      createdAt,
      updatedAt: createdAt,
      hiddenAt: null,
      hiddenReason: null,
      ...extra,
    };
    state.statistics.push(row);
    addLog(contributor.id, "stat_report_create", createdAt, {
      statisticId: row.id,
      sittingId: s.id,
    });
    return row;
  };

  stat(s1, crowd[0], figures(38, 11), ago(1, 5));
  stat(
    s1,
    crowd[1],
    { ...figures(40, 10), note: "분반 평균 기준입니다" },
    ago(0, 6),
    { nickname: "공대생" },
  );
  stat(s2, student, figures(45, 9), r1Start + 75 * DAY_MS, {
    nickname: "수학러버",
  });
  stat(s2, crowd[2], figures(47, 8), r1Start + 76 * DAY_MS);
  const hidden = stat(
    s2,
    crowd[3],
    { ...figures(90, 1), note: "테스트" },
    r1Start + 77 * DAY_MS,
  );
  hidden.hiddenAt = r1Start + 78 * DAY_MS;
  hidden.hiddenReason = "테스트 제보";
  addLog(moderator.id, "stat_report_hide", hidden.hiddenAt, {
    statisticId: hidden.id,
    reason: hidden.hiddenReason,
  });
  stat(s3, crowd[4], figures(52, 7), r1Start + 15 * DAY_MS);
  stat(
    s4,
    crowd[5],
    {
      q1: null,
      q2: null,
      q3: null,
      q4: null,
      average: 7.2,
      maxScore: 10,
      note: null,
    },
    r2Start + 2 * DAY_MS,
  );
  stat(s5, crowd[6], figures(62, 6), ago(3));
  stat(s7, student, figures(70, 5), r1Start + 61 * DAY_MS);
  stat(
    s7,
    crowd[7],
    { ...figures(68, 6), note: "영어 에세이 포함" },
    r1Start + 62 * DAY_MS,
  );
  stat(s9, crowd[8], figures(35, 12), r1Start + 8 * DAY_MS);
  stat(
    s9,
    crowd[9],
    {
      q1: null,
      q2: 48,
      q3: null,
      q4: null,
      average: 50.5,
      maxScore: 100,
      note: null,
    },
    r1Start + 9 * DAY_MS,
  );
  stat(s11, crowd[10], figures(41, 9), r1Start + 80 * DAY_MS);
  stat(s11, crowd[11], figures(43, 9), r1Start + 81 * DAY_MS);
  stat(s13, crowd[12], figures(55, 8), r2Start + 16 * DAY_MS);
  stat(s15, crowd[13], figures(60, 7), r1Start + 70 * DAY_MS);
  stat(s16, crowd[0], figures(30, 10, 80), r2Start + 12 * DAY_MS);
  stat(s17, crowd[1], figures(58, 6), within(R3, 50));
  stat(
    s18,
    crowd[2],
    {
      q1: null,
      q2: null,
      q3: null,
      q4: null,
      average: null,
      maxScore: null,
      note: "출석 점수 10% 반영, 나머지는 과제",
    },
    r1Start + 31 * DAY_MS,
  );
  stat(s19, crowd[3], figures(49, 10), r2Start + 72 * DAY_MS);
  stat(s20, crowd[4], figures(80, 4, 100), ago(2));

  // -------------------------------------------------------------- uploads
  const report = (
    course: CatalogCourse,
    s: { kindId: number; number: number | null; term: Term },
    uploader: UserRow,
    file: { name: string; type: ReportRow["contentType"]; bytes: Uint8Array },
    createdAt: number,
    nickname = "(익명)",
  ): ReportRow => {
    const row: ReportRow = {
      id: nextId(state, "reports"),
      courseId: course.id,
      kindId: s.kindId,
      number: s.number,
      year: s.term.year,
      semester: s.term.semester,
      uploaderId: uploader.id,
      nickname,
      fileName: file.name,
      contentType: file.type,
      bytes: file.bytes,
      status: "pending",
      reviewerId: null,
      reviewedAt: null,
      reviewNote: null,
      linkedStatisticId: null,
      createdAt,
    };
    state.reports.push(row);
    addLog(uploader.id, "pending_report_create", createdAt, {
      reportId: row.id,
      courseId: course.id,
    });
    return row;
  };
  const png = (name: string, values: number[]) => ({
    name,
    type: "image/png" as const,
    bytes: barChartPng(values),
  });
  const pdf = (name: string, lines: string[]) => ({
    name,
    type: "application/pdf" as const,
    bytes: textPdf(lines),
  });

  report(
    C0,
    { kindId: KIND.midterm, number: null, term: T },
    student,
    png("midterm-dist.png", [2, 5, 9, 12, 7, 3]),
    ago(2),
    "수학러버",
  );
  report(
    C1,
    { kindId: KIND.exam, number: 1, term: T },
    crowd[5],
    pdf("exam1-scores.pdf", [
      "Exam 1 score distribution",
      "Q1 58  Q2 64  Q3 71  Q4 92",
      "Average 65.2 / 100",
    ]),
    ago(1),
  );
  report(
    C2,
    { kindId: KIND.final, number: null, term: R1 },
    crowd[7],
    png("final.png", [1, 3, 6, 10, 8, 4, 2]),
    ago(0, 5),
    "밤샘러",
  );
  const approved = report(
    C2,
    { kindId: KIND.midterm, number: null, term: R1 },
    crowd[8],
    png("midterm-slide.png", [3, 6, 8, 5, 2]),
    r1Start + 7 * DAY_MS,
  );
  const rejected = report(
    C3,
    { kindId: KIND.final, number: null, term: R1 },
    crowd[9],
    pdf("blurry.pdf", ["(unreadable photo)"]),
    r1Start + 72 * DAY_MS,
  );

  const transcribed = stat(
    s9,
    crowd[8],
    figures(33, 11),
    r1Start + 8 * DAY_MS,
    {
      source: "transcribed",
      sourceReportId: approved.id,
      nickname: approved.nickname,
    },
  );
  Object.assign(approved, {
    status: "approved",
    reviewerId: admin.id,
    reviewedAt: transcribed.createdAt,
    reviewNote: "슬라이드 판독 완료",
    linkedStatisticId: transcribed.id,
  });
  addLog(admin.id, "report_file_view", transcribed.createdAt - HOUR, {
    reportId: approved.id,
  });
  addLog(admin.id, "pending_report_approve", transcribed.createdAt, {
    reportId: approved.id,
    statisticId: transcribed.id,
  });
  Object.assign(rejected, {
    status: "rejected",
    reviewerId: moderator.id,
    reviewedAt: rejected.createdAt + DAY_MS,
    reviewNote: "사진이 흐려 판독할 수 없습니다",
  });
  addLog(moderator.id, "pending_report_reject", rejected.reviewedAt!, {
    reportId: rejected.id,
  });

  // ------------------------------------------------------ voting requests
  const request = (
    s: SittingRow,
    u: UserRow,
    createdAt: number,
    note: string | null = null,
    resolution?: {
      status: VotingRequestRow["status"];
      at: number;
      by: number | null;
    },
  ) => {
    const r: VotingRequestRow = {
      id: nextId(state, "votingRequests"),
      sittingId: s.id,
      userId: u.id,
      note,
      status: resolution?.status ?? "open",
      createdAt,
      resolvedAt: resolution?.at ?? null,
      resolvedBy: resolution?.by ?? null,
    };
    state.votingRequests.push(r);
    addLog(u.id, "voting_request_create", createdAt, {
      requestId: r.id,
      sittingId: s.id,
    });
    if (r.status === "cancelled")
      addLog(u.id, "voting_request_cancel", r.resolvedAt!, { requestId: r.id });
    if (r.status === "rejected")
      addLog(r.resolvedBy, "voting_request_reject", r.resolvedAt!, {
        sittingId: s.id,
      });
    return r;
  };
  for (const [i, u] of crowd.slice(0, 3).entries()) {
    request(s1, u, ago(4, i), i === 0 ? "10월 첫 주 시험" : null, {
      status: "fulfilled",
      at: s1.votingOpenedAt!,
      by: admin.id,
    });
  }
  request(s6, student, ago(3), "10월 21일 시험이에요");
  request(s6, crowd[4], ago(3, 5));
  request(s6, crowd[5], ago(2), "2차 시험 끝나면 열어주세요");
  request(s6, crowd[6], ago(1));
  request(s8, student, ago(2, 3));
  request(s8, crowd[7], ago(2));
  request(s8, crowd[8], ago(1, 8), "마감 10/2");
  request(s12, crowd[9], ago(4));
  request(s12, crowd[10], ago(9), null, {
    status: "rejected",
    at: ago(3),
    by: moderator.id,
  });
  request(s12, student, ago(8), null, {
    status: "cancelled",
    at: ago(7),
    by: student.id,
  });
  request(s14, crowd[11], ago(3));
  request(s14, crowd[12], ago(2, 2));

  // ------------------------------------------------------------- comments
  const comment = (
    course: CatalogCourse,
    u: UserRow,
    body: string,
    createdAt: number,
  ) => {
    const row: CommentRow = {
      id: nextId(state, "comments"),
      courseId: course.id,
      userId: u.id,
      body,
      createdAt,
    };
    state.comments.push(row);
    addLog(u.id, "comment_create", createdAt, {
      commentId: row.id,
      courseId: course.id,
    });
  };
  const commenters = [student, ...crowd, deletedUser];
  COMMENT_BODIES.forEach((body, i) =>
    comment(C0, commenters[i % commenters.length], body, ago(i * 3 + 1, i)),
  );
  for (let i = 0; i < 5; i++)
    comment(
      C1,
      crowd[(i * 3) % crowd.length],
      COMMENT_BODIES[(i * 5) % COMMENT_BODIES.length],
      ago(i * 7 + 2),
    );
  for (let i = 0; i < 6; i++)
    comment(
      C2,
      crowd[(i * 2 + 1) % crowd.length],
      COMMENT_BODIES[(i * 7 + 3) % COMMENT_BODIES.length],
      ago(i * 5 + 1, 3),
    );
  comment(C3, student, "선대는 무조건 복습이 답", ago(12));
  comment(C4, crowd[14], "그래프 문제 많이 나와요", ago(30));
  comment(C4, deletedUser, "작년 기준 중간 평균 55점", ago(200));

  // ------------------------------------------------------------ favorites
  const favorite = (u: UserRow, c: CatalogCourse, createdAt: number) => {
    state.favorites.push({ userId: u.id, courseId: c.id, createdAt, position: -createdAt });
    addLog(u.id, "favorite_add", createdAt, { courseId: c.id });
  };
  favorite(student, C0, ago(1));
  favorite(student, C2, ago(3));
  favorite(student, C1, ago(10));
  favorite(student, C5, ago(20));
  favorite(admin, C3, ago(15));
  favorite(moderator, C0, ago(40));

  // ------------------------------------------------------------ operations
  const catalog = ctx.catalog;
  const lastTerm = catalog.courses.reduce(
    (t, c) => Math.max(t, c.latestTerm.year * 10 + c.latestTerm.semester),
    0,
  );
  const coursesAdded = catalog.courses.filter((c) => {
    const first = c.offerings[c.offerings.length - 1];
    return first && first.year * 10 + first.semester === lastTerm;
  }).length;
  state.catalogImports = [
    {
      id: nextId(state, "catalogImports"),
      startedAt: ago(60),
      finishedAt: ago(60) + 40_000,
      status: "failed",
      sourceLabel: catalog.sourceLabel,
      coursesTotal: null,
      coursesAdded: null,
      coursesUnlisted: null,
      offeringsTotal: null,
      sectionsTotal: null,
      error: "source file 2025-3.json: unexpected end of JSON input",
    },
    {
      id: nextId(state, "catalogImports"),
      startedAt: ago(3, 4),
      finishedAt: ago(3, 4) + 95_000,
      status: "succeeded",
      sourceLabel: catalog.sourceLabel,
      coursesTotal: catalog.courses.length,
      coursesAdded,
      coursesUnlisted: catalog.courses.filter((c) => !c.listed).length,
      offeringsTotal: catalog.offeringsTotal,
      sectionsTotal: catalog.sectionsTotal,
      error: null,
    },
  ];

  const archiveRun = (
    daysAgo: number,
    status: "succeeded" | "failed",
    rowCount: number | null,
    error: string | null = null,
  ) => {
    const startedAt = ago(daysAgo, 21);
    state.archiveRuns.push({
      id: nextId(state, "archiveRuns"),
      startedAt,
      finishedAt: startedAt + 70_000,
      status,
      cutoff: startedAt - 90 * DAY_MS,
      format: "jsonl",
      rowCount,
      driveFileId:
        status === "succeeded"
          ? `1mockDrive${daysAgo.toString().padStart(3, "0")}xYz`
          : null,
      error,
    });
    if (status === "succeeded")
      addLog(null, "logs_archive", startedAt + 70_000, {
        rowCount,
        format: "jsonl",
      });
  };
  archiveRun(28, "succeeded", 1204);
  archiveRun(21, "succeeded", 980);
  archiveRun(14, "failed", null, "Drive API 403: insufficientPermissions");
  archiveRun(7, "succeeded", 1113);
  addLog(null, "logs_retention_delete", ago(1, 20), {
    deleted: 0,
    cutoff: iso(ago(366)),
  });

  const jobRun = (
    name: "retention" | "archive",
    daysAgo: number,
    affected: number,
  ) => {
    const startedAt = ago(daysAgo, 21);
    return {
      name,
      startedAt: iso(startedAt)!,
      finishedAt: iso(startedAt + 70_000)!,
      status: "succeeded" as const,
      affected,
      error: null,
    };
  };
  state.jobs = [
    {
      name: "retention",
      enabled: true,
      settings: { days: 365 },
      lastRun: jobRun("retention", 1, 0),
    },
    {
      name: "archive",
      enabled: true,
      settings: {
        afterDays: 90,
        format: "jsonl",
        auth: "oauth",
        interval: "24h",
      },
      lastRun: jobRun("archive", 7, 1113),
    },
    {
      name: "upload-gc",
      enabled: false,
      settings: { afterHours: 24 },
      lastRun: null,
    },
  ];

  // Admin browsing traffic, so the log has depth for pagination and filters.
  for (let i = 0; i < 12; i++) {
    addLog(pick([admin, moderator]).id, "report_file_view", ago(i * 4 + 2, i), {
      reportId: 1 + (i % 3),
    });
  }
  addLog(admin.id, "logs_export", ago(10), { format: "csv", count: 42 });

  // Ids follow time, as they would in the database.
  logs.sort((a, b) => a.createdAt - b.createdAt);
  state.logs = logs.map((l) => ({ id: nextId(state, "logs"), ...l }));
  return state;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
