import type { JobWithMetadata } from "pg-boss";

type QueueConfig<T = unknown> = {
  handler: (data: T) => Promise<void>;
  batchSize?: number;
  expireInSeconds?: number;
  retryLimit?: number;
};

type ScheduleConfig = {
  queue: string;
  cron: string;
};

type JobSystemConfig = {
  connectionString: string;
  schema?: string;
  queues: Record<string, QueueConfig>;
  schedules?: ScheduleConfig[];
  cleanOrphans?: boolean;
  onError?: (err: Error) => void;
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

export type {
  QueueConfig,
  ScheduleConfig,
  JobSystemConfig,
  QueueStats,
  JobInfo,
  DashboardData,
  AnyJob,
};
