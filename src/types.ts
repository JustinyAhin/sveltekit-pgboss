import type { JobWithMetadata, PgBoss } from "pg-boss";

type QueueConfig<T = unknown> = {
  /** @internal Phantom field for type inference — never set at runtime. */
  __payload?: T;
  batchSize?: number;
  expireInSeconds?: number;
  retryLimit?: number;
  retryDelay?: number;
  localConcurrency?: number;
  onFailed?: (opts: { data: T; error: unknown }) => Promise<void>;
};

type ScheduleConfig = {
  queue: string;
  cron: string;
};

type JobSystemConfig<Q extends Record<string, QueueConfig<any>> = Record<string, QueueConfig>> = {
  connectionString: string;
  schema?: string;
  queues: Q;
  schedules?: ScheduleConfig[];
  cleanOrphans?: boolean;
  onError?: (err: Error) => void;
};

/** Extracts each queue's payload type from its QueueConfig, building a { queueName: PayloadType } map. */
type PayloadMap<Q extends Record<string, QueueConfig<any>>> = {
  [K in keyof Q]: Q[K] extends QueueConfig<infer T> ? T : never;
};

/** Maps each queue name to a handler function with the correct payload type. */
type HandlersMap<Q extends Record<string, QueueConfig<any>>> = {
  [K in keyof Q & string]: (data: PayloadMap<Q>[K]) => Promise<unknown>;
};

type QueueStats = {
  name: string;
  queuedCount: number;
  activeCount: number;
  deferredCount: number;
  totalCount: number;
};

type JobInfo = {
  id: string;
  name: string;
  state: string;
  data: Record<string, unknown>;
  createdOn: Date;
  startedOn: Date | null;
  completedOn: Date | null;
  retryCount: number;
  retryLimit: number;
  singletonKey: string | null;
  output: unknown;
};

type PaginationInfo = {
  page: number;
  totalPages: number;
  totalCount: number;
  perPage: number;
};

type DashboardData = {
  queues: QueueStats[];
  jobs: JobInfo[];
  pagination: PaginationInfo;
};

type Dashboard = {
  getStats: () => Promise<QueueStats[]>;
  getRecentJobs: (opts?: {
    page?: number;
    perPage?: number;
  }) => Promise<{ jobs: JobInfo[]; pagination: PaginationInfo }>;
  getData: (opts?: { page?: number; perPage?: number }) => Promise<DashboardData>;
  rerunJob: (opts: { queue: string; jobId: string }) => Promise<{ queued: boolean }>;
};

type AnyJob = JobWithMetadata<Record<string, unknown>>;

type CreateDashboardOpts = {
  connectionString: string;
  schema: string;
  queueNames: string[];
  getBoss: () => Promise<PgBoss>;
};

export type {
  QueueConfig,
  ScheduleConfig,
  JobSystemConfig,
  PayloadMap,
  HandlersMap,
  QueueStats,
  JobInfo,
  PaginationInfo,
  DashboardData,
  Dashboard,
  AnyJob,
  CreateDashboardOpts,
};
