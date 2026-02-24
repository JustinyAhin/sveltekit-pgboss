import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PgBoss } from "pg-boss";
import { createInitJobs } from "../init.js";

// Mock pg module — cleanOrphanedJobs creates its own Pool
const mockQuery = vi.fn().mockResolvedValue({ rows: [{ count: 0 }] });
const mockEnd = vi.fn().mockResolvedValue(undefined);

vi.mock("pg", () => {
  class MockPool {
    query = mockQuery;
    end = mockEnd;
  }
  return { Pool: MockPool };
});

// Helper to create a mock PgBoss with spied methods
const createMockBoss = () => {
  const workCallbacks = new Map<string, (jobs: any[]) => Promise<void>>();
  return {
    getQueue: vi.fn().mockResolvedValue(null),
    createQueue: vi.fn().mockResolvedValue(undefined),
    updateQueue: vi.fn().mockResolvedValue(undefined),
    work: vi.fn(async (_name: string, _opts: any, cb: any) => {
      workCallbacks.set(_name, cb);
    }),
    fail: vi.fn().mockResolvedValue(undefined),
    schedule: vi.fn().mockResolvedValue(undefined),
    workCallbacks,
  } as unknown as PgBoss & {
    workCallbacks: Map<string, (jobs: any[]) => Promise<void>>;
  };
};

const makeJob = (
  overrides: Partial<{ id: string; data: any; retryCount: number; retryLimit: number }> = {},
) => ({
  id: overrides.id ?? "job-1",
  data: overrides.data ?? { foo: "bar" },
  retryCount: overrides.retryCount ?? 0,
  retryLimit: overrides.retryLimit ?? 3,
});

describe("createInitJobs", () => {
  let boss: ReturnType<typeof createMockBoss>;

  beforeEach(() => {
    boss = createMockBoss();
    vi.clearAllMocks();
  });

  const setup = (
    queues: Record<string, any>,
    opts?: { cleanOrphans?: boolean; schedules?: any[] },
  ) =>
    createInitJobs({
      connectionString: "postgres://localhost/test",
      schema: "pgboss",
      queues,
      cleanOrphans: opts?.cleanOrphans ?? false,
      schedules: opts?.schedules,
      getBoss: async () => boss as unknown as PgBoss,
    });

  // --- Single-job path ---

  it("calls handler with job data on success", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const initJobs = setup({ myqueue: {} });
    await initJobs({ myqueue: handler });

    const cb = boss.workCallbacks.get("myqueue")!;
    await cb([makeJob({ data: { email: "a@b.com" } })]);

    expect(handler).toHaveBeenCalledWith({ email: "a@b.com" });
  });

  it("re-throws error and does NOT call onFailed when retries remain", async () => {
    const onFailed = vi.fn();
    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    const initJobs = setup({ myqueue: { retryLimit: 3, onFailed } });
    await initJobs({ myqueue: handler });

    const cb = boss.workCallbacks.get("myqueue")!;
    const job = makeJob({ retryCount: 1, retryLimit: 3 });

    await expect(cb([job])).rejects.toThrow("boom");
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("re-throws error and calls onFailed on final retry", async () => {
    const onFailed = vi.fn().mockResolvedValue(undefined);
    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    const initJobs = setup({ myqueue: { retryLimit: 3, onFailed } });
    await initJobs({ myqueue: handler });

    const cb = boss.workCallbacks.get("myqueue")!;
    const job = makeJob({ retryCount: 3, retryLimit: 3, data: { x: 1 } });

    await expect(cb([job])).rejects.toThrow("boom");
    expect(onFailed).toHaveBeenCalledWith({
      data: { x: 1 },
      error: expect.any(Error),
    });
  });

  // --- Batch path ---

  it("calls boss.fail() with only failed job IDs in batch mode", async () => {
    const handler = vi.fn().mockImplementation(async (data: any) => {
      if (data.fail) throw new Error("nope");
    });
    const initJobs = setup({ myqueue: { batchSize: 3 } });
    await initJobs({ myqueue: handler });

    const cb = boss.workCallbacks.get("myqueue")!;
    const jobs = [
      makeJob({ id: "ok-1", data: { fail: false } }),
      makeJob({ id: "fail-1", data: { fail: true } }),
      makeJob({ id: "ok-2", data: { fail: false } }),
    ];

    await cb(jobs);

    expect((boss as any).fail).toHaveBeenCalledWith("myqueue", ["fail-1"]);
  });

  it("calls onFailed only for exhausted retries in batch mode", async () => {
    const onFailed = vi.fn().mockResolvedValue(undefined);
    const handler = vi.fn().mockRejectedValue(new Error("fail"));
    const initJobs = setup({ myqueue: { batchSize: 2, onFailed } });
    await initJobs({ myqueue: handler });

    const cb = boss.workCallbacks.get("myqueue")!;
    const jobs = [
      makeJob({ id: "j1", retryCount: 0, retryLimit: 3, data: { a: 1 } }),
      makeJob({ id: "j2", retryCount: 3, retryLimit: 3, data: { b: 2 } }),
    ];

    await cb(jobs);

    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onFailed).toHaveBeenCalledWith({
      data: { b: 2 },
      error: expect.any(Error),
    });
  });

  // --- Queue setup ---

  it("creates new queues and updates config when options present", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const initJobs = setup({
      q1: { retryLimit: 5, expireInSeconds: 60 },
      q2: {},
    });
    await initJobs({ q1: handler, q2: handler });

    expect((boss as any).createQueue).toHaveBeenCalledWith("q1");
    expect((boss as any).createQueue).toHaveBeenCalledWith("q2");
    expect((boss as any).updateQueue).toHaveBeenCalledWith("q1", {
      retryLimit: 5,
      expireInSeconds: 60,
    });
    // q2 has no config options, so updateQueue should NOT be called for it
    expect((boss as any).updateQueue).not.toHaveBeenCalledWith("q2", expect.anything());
  });

  // --- Orphan cleanup ---

  it("executes orphan cleanup SQL and tears down pool", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const initJobs = setup({ myqueue: {} }, { cleanOrphans: true });
    await initJobs({ myqueue: handler });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("UPDATE pgboss.job");
    expect(sql).toContain("retry_count < retry_limit");
    expect(mockEnd).toHaveBeenCalled();
  });

  // --- Idempotency ---

  it("only initializes once even when called twice", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const initJobs = setup({ myqueue: {} });
    await initJobs({ myqueue: handler });
    await initJobs({ myqueue: handler });

    expect((boss as any).work).toHaveBeenCalledTimes(1);
  });
});
