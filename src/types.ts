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

type PayloadMap<Q extends Record<string, QueueConfig<any>>> = {
  [K in keyof Q]: Q[K] extends QueueConfig<infer T> ? T : never;
};

type HandlersMap<Q extends Record<string, QueueConfig<any>>> = {
  [K in keyof Q & string]: (data: PayloadMap<Q>[K]) => Promise<void>;
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

type DashboardData = {
  queues: QueueStats[];
  jobs: JobInfo[];
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
  DashboardData,
  AnyJob,
  CreateDashboardOpts,
};
