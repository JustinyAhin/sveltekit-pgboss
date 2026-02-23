import type { SendOptions } from "pg-boss";
import { createBossManager } from "./boss.js";
import { createInitJobs } from "./init.js";
import { createDashboard } from "./dashboard.js";
import type { HandlersMap, JobSystemConfig, PayloadMap, QueueConfig } from "./types.js";

const queue = <T>(config?: Omit<QueueConfig<T>, "__payload">): QueueConfig<T> => {
  return (config ?? {}) as QueueConfig<T>;
};

const createJobSystem = <Q extends Record<string, QueueConfig<any>>>(
  config: JobSystemConfig<Q>,
) => {
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

  const initJobs = (handlers: HandlersMap<Q>) =>
    _initJobs(handlers as Record<string, (data: unknown) => Promise<void>>);

  const queueNames = Object.keys(config.queues);

  const dashboard = createDashboard({
    connectionString: config.connectionString,
    schema,
    queueNames,
    getBoss,
  });

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
  DashboardData,
} from "./types.js";
