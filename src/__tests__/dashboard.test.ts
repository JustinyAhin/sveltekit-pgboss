import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PgBoss } from "pg-boss";
import { createDashboard } from "../dashboard.js";

const mockQuery = vi.fn();

vi.mock("pg", () => {
  class MockPool {
    query = mockQuery;
  }
  return { Pool: MockPool };
});

const createMockBoss = () =>
  ({
    findJobs: vi.fn().mockResolvedValue([]),
    send: vi.fn().mockResolvedValue("new-job-id"),
  }) as unknown as PgBoss;

const setup = () =>
  createDashboard({
    connectionString: "postgres://localhost/test",
    schema: "pgboss",
    queueNames: ["email", "reports"],
    getBoss: async () => createMockBoss(),
  });

describe("createDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getRecentJobs", () => {
    it("uses default page=1 perPage=50 when no args given", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: "j1", name: "email", state: "completed" }],
      });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });

      const dashboard = setup();
      const result = await dashboard.getRecentJobs();

      // Jobs query with LIMIT 50 OFFSET 0
      const jobsCall = mockQuery.mock.calls[0]!;
      expect(jobsCall[1]).toEqual([["email", "reports"], 50, 0]);

      // Count query
      const countCall = mockQuery.mock.calls[1]!;
      expect(countCall[1]).toEqual([["email", "reports"]]);

      expect(result.jobs).toEqual([{ id: "j1", name: "email", state: "completed" }]);
      expect(result.pagination).toEqual({
        page: 1,
        totalPages: 1,
        totalCount: 1,
        perPage: 50,
      });
    });

    it("computes correct offset for page 3", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 120 }] });

      const dashboard = setup();
      const result = await dashboard.getRecentJobs({ page: 3, perPage: 25 });

      const jobsCall = mockQuery.mock.calls[0]!;
      // offset = (3 - 1) * 25 = 50
      expect(jobsCall[1]).toEqual([["email", "reports"], 25, 50]);

      expect(result.pagination).toEqual({
        page: 3,
        totalPages: 5, // ceil(120 / 25)
        totalCount: 120,
        perPage: 25,
      });
    });

    it("handles zero jobs", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });

      const dashboard = setup();
      const result = await dashboard.getRecentJobs();

      expect(result.jobs).toEqual([]);
      expect(result.pagination).toEqual({
        page: 1,
        totalPages: 0,
        totalCount: 0,
        perPage: 50,
      });
    });
  });

  describe("getData", () => {
    it("returns queues, jobs, and pagination", async () => {
      const statsRows = [
        { name: "email", queuedCount: 5, activeCount: 2, deferredCount: 0, totalCount: 7 },
      ];
      const jobRows = [{ id: "j1", name: "email", state: "created" }];

      // getStats query
      mockQuery.mockResolvedValueOnce({ rows: statsRows });
      // getRecentJobs query
      mockQuery.mockResolvedValueOnce({ rows: jobRows });
      // count query
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });

      const dashboard = setup();
      const result = await dashboard.getData({ page: 1, perPage: 10 });

      expect(result.queues).toEqual(statsRows);
      expect(result.jobs).toEqual(jobRows);
      expect(result.pagination).toEqual({
        page: 1,
        totalPages: 1,
        totalCount: 1,
        perPage: 10,
      });
    });

    it("uses defaults when called with no args", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });

      const dashboard = setup();
      const result = await dashboard.getData();

      expect(result.pagination.perPage).toBe(50);
      expect(result.pagination.page).toBe(1);
    });
  });
});
