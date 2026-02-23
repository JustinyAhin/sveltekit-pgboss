import type { SendOptions } from "pg-boss";
import { createBossManager } from "./boss.js";
import { createInitJobs } from "./init.js";
import { createDashboard } from "./dashboard.js";
import type { JobSystemConfig, PayloadMap, QueueConfig } from "./types.js";

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

  const initJobs = createInitJobs({
    connectionString: config.connectionString,
    schema,
    queues: config.queues,
    schedules: config.schedules,
    cleanOrphans: config.cleanOrphans ?? true,
    getBoss,
  });

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

export { createJobSystem };
export type {
  JobSystemConfig,
  PayloadMap,
  QueueConfig,
  ScheduleConfig,
  QueueStats,
  JobInfo,
  DashboardData,
} from "./types.js";
