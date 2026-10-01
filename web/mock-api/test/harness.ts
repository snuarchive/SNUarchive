import { beforeAll, beforeEach } from "vitest";
import type { MockApp } from "../src/app";
import { createApp } from "../src/app";
import type { MockOptions } from "../src/config";
import { votingState } from "../src/domain";
import { pickSeedCourses, SEED_ACCOUNTS } from "../src/seed";
import { Client } from "./client";
import { Contract } from "./contract";

let shared: Promise<Contract> | undefined;

/** One contract instance per test file, so coverage accumulates across suites. */
export function loadContract(): Promise<Contract> {
  shared ??= Contract.load();
  return shared;
}

export interface H {
  readonly mock: MockApp;
  readonly contract: Contract;
  client(mock?: MockApp): Client;
  as(email: string, mock?: MockApp): Promise<Client>;
  admin(): Promise<Client>;
  student(): Promise<Client>;
  /** A separate app with other options, checked against the same contract. */
  app(overrides: Partial<MockOptions>): MockApp;
}

export function useHarness(): H {
  let mock: MockApp;
  let contract: Contract;
  beforeAll(async () => {
    contract = await loadContract();
    mock = createApp();
  });
  beforeEach(() => mock.reset());
  const h: H = {
    get mock() {
      return mock;
    },
    get contract() {
      return contract;
    },
    client: (m = mock) => new Client(m, contract),
    as: (email, m = mock) => new Client(m, contract).login(email),
    admin: () => h.as(SEED_ACCOUNTS.admin),
    student: () => h.as(SEED_ACCOUNTS.student),
    app: (overrides) => createApp(overrides),
  };
  return h;
}

/** Handles on seeded rows, found by their role rather than by id. */
export function refs(mock: MockApp) {
  const st = mock.ctx.state;
  const now = mock.ctx.now();
  const user = (email: string) => st.users.find((u) => u.email === email)!;
  const student = user(SEED_ACCOUNTS.student);
  const courses = pickSeedCourses(mock.ctx.catalog.courses);
  const state = (s: (typeof st.sittings)[number]) => votingState(s, now);
  const open = st.sittings.filter((s) => state(s) === "open");
  const studentOpenRequest = st.votingRequests.find(
    (r) => r.userId === student.id && r.status === "open",
  )!;
  return {
    courses,
    course: courses[0],
    emptyCourse: courses[9],
    student,
    admin: user(SEED_ACCOUNTS.admin),
    moderator: user(SEED_ACCOUNTS.moderator),
    newbie: user(SEED_ACCOUNTS.newbie),
    deletedUser: st.users.find((u) => u.deletedAt !== null)!,
    openSitting: open
      .filter((s) => s.votingClosesAt !== null)
      .sort((a, b) => b.votingClosesAt! - a.votingClosesAt!)[0],
    openEndedSitting: open.find((s) => s.votingClosesAt === null)!,
    closedSitting: st.sittings.find((s) => state(s) === "closed")!,
    neverSitting: st.sittings.find(
      (s) =>
        state(s) === "never" &&
        !st.votingRequests.some((r) => r.sittingId === s.id),
    )!,
    studentOpenRequest,
    requestedSitting: st.sittings.find(
      (s) => s.id === studentOpenRequest.sittingId,
    )!,
    othersOpenRequest: st.votingRequests.find(
      (r) => r.userId !== student.id && r.status === "open",
    )!,
    pendingReport: st.reports.find((r) => r.status === "pending")!,
    approvedReport: st.reports.find((r) => r.status === "approved")!,
    hiddenStatistic: st.statistics.find((s) => s.hiddenAt !== null)!,
    visibleStatistic: st.statistics.find(
      (s) => s.hiddenAt === null && s.q1 !== null,
    )!,
  };
}

export const UNKNOWN_ID = 987654321;
export { SEED_ACCOUNTS };
