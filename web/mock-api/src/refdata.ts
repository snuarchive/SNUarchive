import type { S } from "./types";

export type AssessmentKind = S<"AssessmentKind">;

// Seeded kinds from the backend design (§4.3).
export const ASSESSMENT_KINDS: AssessmentKind[] = [
  {
    id: 1,
    code: "midterm",
    label: "중간",
    numbered: false,
    maxNumber: null,
    labelFormat: "중간",
    sortOrder: 10,
  },
  {
    id: 2,
    code: "final",
    label: "기말",
    numbered: false,
    maxNumber: null,
    labelFormat: "기말",
    sortOrder: 20,
  },
  {
    id: 3,
    code: "exam",
    label: "시험",
    numbered: true,
    maxNumber: 6,
    labelFormat: "{n}차 시험",
    sortOrder: 30,
  },
  {
    id: 4,
    code: "quiz",
    label: "퀴즈",
    numbered: true,
    maxNumber: 20,
    labelFormat: "퀴즈 {n}",
    sortOrder: 40,
  },
  {
    id: 5,
    code: "assignment",
    label: "과제",
    numbered: true,
    maxNumber: 20,
    labelFormat: "과제 {n}",
    sortOrder: 50,
  },
  {
    id: 6,
    code: "other",
    label: "기타",
    numbered: false,
    maxNumber: null,
    labelFormat: "기타",
    sortOrder: 60,
  },
];

export const KIND = {
  midterm: 1,
  final: 2,
  exam: 3,
  quiz: 4,
  assignment: 5,
  other: 6,
} as const;

export function kindById(id: number): AssessmentKind | undefined {
  return ASSESSMENT_KINDS.find((k) => k.id === id);
}

export function sittingLabel(kindId: number, number: number | null): string {
  const kind = kindById(kindId);
  if (!kind) return "?";
  return kind.labelFormat.replace("{n}", String(number ?? ""));
}

// The legacy app's college list (api/_utils.js), kept in its order.
const COLLEGE_NAMES = [
  "인문대학",
  "사회과학대학",
  "자연과학대학",
  "간호대학",
  "경영대학",
  "공과대학",
  "농업생명과학대학",
  "미술대학",
  "사범대학",
  "생활과학대학",
  "수의과대학",
  "약학대학",
  "음악대학",
  "의과대학",
  "자유전공학부",
  "법학전문대학원",
  "치의학대학원",
  "대학원/기타",
];

export const COLLEGES: S<"College">[] = COLLEGE_NAMES.map((name, i) => ({
  name,
  sortOrder: (i + 1) * 10,
}));

export const SEMESTERS: S<"Config">["semesters"] = [
  { value: 1, label: "1학기" },
  { value: 2, label: "여름학기" },
  { value: 3, label: "2학기" },
  { value: 4, label: "겨울학기" },
];

export const LIMITS = {
  uploadMaxBytes: 3 * 1024 * 1024,
  uploadAccepts: [
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
  ] as const,
  commentMaxLength: 50,
  nicknameMaxLength: 10,
  anonymous: "(익명)",
  votingRequestNoteMaxLength: 100,
  statisticNoteMaxLength: 500,
  reviewNoteMaxLength: 500,
  hiddenReasonMaxLength: 500,
  displayNameMaxLength: 120,
  scoreMax: 9999.99,
  yearMin: 1980,
  yearMax: 2200,
  admissionYearMin: 1980,
  admissionYearMax: 2100,
  deletePreviewTtlMs: 10 * 60 * 1000,
};

export function configBody(): S<"Config"> {
  return {
    // The mock always serves POST /auth/dev-login.
    devLoginEnabled: true,
    assessmentKinds: ASSESSMENT_KINDS,
    colleges: COLLEGES,
    semesters: SEMESTERS,
    upload: {
      maxBytes: LIMITS.uploadMaxBytes,
      accepts: [...LIMITS.uploadAccepts],
    },
    comment: { maxLength: LIMITS.commentMaxLength },
    nickname: {
      maxLength: LIMITS.nicknameMaxLength,
      anonymous: LIMITS.anonymous,
    },
    votingRequest: { noteMaxLength: LIMITS.votingRequestNoteMaxLength },
  };
}
