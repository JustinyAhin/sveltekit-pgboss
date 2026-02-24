import type { PgBoss, SendOptions } from "pg-boss";
import { createBossManager } from "./boss.js";
import { createInitJobs } from "./init.js";
import { createDashboard } from "./dashboard.js";
import type { Dashboard, HandlersMap, JobSystemConfig, PayloadMap, QueueConfig } from "./types.js";

/**
 * Define a typed queue. The generic parameter `T` sets the payload type
 * enforced by `send()` and handler signatures.
 *
 * @example
 * const queues = {
 *   email: queue<{ to: string; body: string }>({ retryLimit: 3 }),
 * };
 */
// The Omit hides __payload from the public API; the cast preserves T for type inference downstream.
const queue = <T>(config?: Omit<QueueConfig<T>, "__payload">): QueueConfig<T> => {
  return (config ?? {}) as QueueConfig<T>;
};

/**
 * Create a pg-boss job system. Returns `send` for enqueuing jobs,
 * `initJobs` for registering workers (call once at server startup),
 * and `dashboard` for queue stats / job inspection.
 */
const createJobSystem = <Q extends Record<string, QueueConfig<any>>>(
  config: JobSystemConfig<Q>,
): {
  getBoss: () => Promise<PgBoss>;
  stopBoss: () => Promise<void>;
  initJobs: (handlers: HandlersMap<Q>) => Promise<void>;
  dashboard: Dashboard;
  send: <K extends keyof PayloadMap<Q> & string>(opts: {
    name: K;
    data: PayloadMap<Q>[K];
    options?: SendOptions;
  }) => Promise<string | null>;
} => {
  type Payloads = PayloadMap<Q>;

  const schema = config.schema ?? "pgboss";
  const onError = config.onError ?? ((err: Error) => console.error("[pg-boss] error:", err));

  const { getBoss, stopBoss } = createBossManager({
    connectionString: config.connectionString,
    schema,
    onError,
  });

  const _initJobs = createInitJobs({
    connectionString: config.connectionString,
    schema,
    queues: config.queues as Record<string, QueueConfig>,
    schedules: config.schedules,
    cleanOrphans: config.cleanOrphans ?? true,
    getBoss,
  });

  /** Register worker handlers for all queues. Call once at server startup (idempotent). */
  // Cast erases the per-queue payload types so init.ts can work with a uniform signature.
  // Type safety is enforced at the call site via HandlersMap<Q>.
  const initJobs = (handlers: HandlersMap<Q>) =>
    _initJobs(handlers as Record<string, (data: unknown) => Promise<unknown>>);

  const queueNames = Object.keys(config.queues);

  const dashboard = createDashboard({
    connectionString: config.connectionString,
    schema,
    queueNames,
    getBoss,
  });

  /** Enqueue a job. The payload type is inferred from the queue definition. */
  const send = async <K extends keyof Payloads & string>(opts: {
    name: K;
    data: Payloads[K];
    options?: SendOptions;
  }): Promise<string | null> => {
    const boss = await getBoss();
    return boss.send(opts.name, opts.data as object, opts.options);
  };

  return { getBoss, stopBoss, initJobs, dashboard, send };
};

export { createJobSystem, queue };
export type {
  JobSystemConfig,
  PayloadMap,
  HandlersMap,
  QueueConfig,
  ScheduleConfig,
  QueueStats,
  JobInfo,
  PaginationInfo,
  DashboardData,
  Dashboard,
} from "./types.js";
