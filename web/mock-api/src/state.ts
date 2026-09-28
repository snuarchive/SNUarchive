import type {
  ActivityAction,
  ExportFormat,
  JobName,
  ReportContentType,
  S,
} from "./types";

// Timestamps are epoch milliseconds internally and ISO strings on the wire.

export interface UserRow {
  id: number;
  email: string | null;
  displayName: string | null;
  /** Database grant only; env admins are resolved from options at read time. */
  dbAdmin: boolean;
  college: string | null;
  admissionYear: number | null;
  lastIp: string | null;
  sessionEpoch: number;
  createdAt: number;
  lastSeenAt: number | null;
  deletedAt: number | null;
}

export interface SessionRow {
  token: string;
  userId: number;
  /** Guards against a reset reusing the id for someone else. */
  email: string;
  epoch: number;
  expiresAt: number;
}

export interface SittingRow {
  id: number;
  courseId: number;
  kindId: number;
  number: number | null;
  year: number;
  semester: 1 | 2 | 3 | 4;
  votingOpenedAt: number | null;
  votingClosesAt: number | null;
  votingEndedAt: number | null;
  createdAt: number;
}

export interface VoteRow {
  id: number;
  sittingId: number;
  userId: number;
  rating: number;
  createdAt: number;
  updatedAt: number;
}

export interface Figures {
  q1: number | null;
  q2: number | null;
  q3: number | null;
  q4: number | null;
  average: number | null;
  maxScore: number | null;
  note: string | null;
}

export interface StatisticRow extends Figures {
  id: number;
  sittingId: number;
  contributorId: number;
  nickname: string;
  source: "direct" | "transcribed";
  sourceReportId: number | null;
  createdAt: number;
  updatedAt: number;
  hiddenAt: number | null;
  hiddenReason: string | null;
}

export interface ReportRow {
  id: number;
  courseId: number;
  kindId: number;
  number: number | null;
  year: number;
  semester: 1 | 2 | 3 | 4;
  uploaderId: number;
  nickname: string;
  fileName: string;
  contentType: ReportContentType;
  bytes: Uint8Array;
  status: "pending" | "approved" | "rejected";
  reviewerId: number | null;
  reviewedAt: number | null;
  reviewNote: string | null;
  linkedStatisticId: number | null;
  createdAt: number;
}

export interface VotingRequestRow {
  id: number;
  sittingId: number;
  userId: number;
  note: string | null;
  status: "open" | "fulfilled" | "rejected" | "cancelled";
  createdAt: number;
  resolvedAt: number | null;
  resolvedBy: number | null;
}

export interface CommentRow {
  id: number;
  courseId: number;
  userId: number;
  body: string;
  createdAt: number;
}

export interface FavoriteRow {
  userId: number;
  courseId: number;
  createdAt: number;
  /**
   * The viewer's own order (`PUT /me/favorites/order`), lower first. A new
   * pin gets a position below every existing one, so it goes to the front.
   */
  position: number;
}

/** Favourites in the viewer's order. */
export function byFavoriteOrder(a: FavoriteRow, b: FavoriteRow): number {
  return a.position - b.position || b.createdAt - a.createdAt;
}

export interface LogRow {
  id: number;
  userId: number | null;
  action: ActivityAction;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: number;
}

export interface ArchiveRunRow {
  id: number;
  startedAt: number;
  finishedAt: number | null;
  status: "running" | "succeeded" | "failed";
  cutoff: number | null;
  format: ExportFormat;
  rowCount: number | null;
  driveFileId: string | null;
  error: string | null;
}

export interface CatalogImportRow {
  id: number;
  startedAt: number;
  finishedAt: number | null;
  status: "running" | "succeeded" | "failed";
  sourceLabel: string | null;
  coursesTotal: number | null;
  coursesAdded: number | null;
  coursesUnlisted: number | null;
  offeringsTotal: number | null;
  sectionsTotal: number | null;
  error: string | null;
}

export interface JobRow {
  name: JobName;
  enabled: boolean;
  settings: Record<string, unknown>;
  lastRun: S<"JobRunResult"> | null;
}

export interface DeletePreview {
  filterKey: string;
  count: number;
  expiresAt: number;
}

export interface State {
  seq: Record<string, number>;
  users: UserRow[];
  sittings: SittingRow[];
  votes: VoteRow[];
  statistics: StatisticRow[];
  reports: ReportRow[];
  votingRequests: VotingRequestRow[];
  comments: CommentRow[];
  favorites: FavoriteRow[];
  logs: LogRow[];
  archiveRuns: ArchiveRunRow[];
  catalogImports: CatalogImportRow[];
  jobs: JobRow[];
  deletePreviews: Map<string, DeletePreview>;
  /** Bumped by writes that change search badges; part of the search ETag. */
  contentVersion: number;
}

export function emptyState(): State {
  return {
    seq: {},
    users: [],
    sittings: [],
    votes: [],
    statistics: [],
    reports: [],
    votingRequests: [],
    comments: [],
    favorites: [],
    logs: [],
    archiveRuns: [],
    catalogImports: [],
    jobs: [],
    deletePreviews: new Map(),
    contentVersion: 1,
  };
}

export function nextId(state: State, table: string): number {
  state.seq[table] = (state.seq[table] ?? 0) + 1;
  return state.seq[table];
}
