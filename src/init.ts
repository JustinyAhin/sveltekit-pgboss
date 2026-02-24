import type { PgBoss } from "pg-boss";
import { Pool } from "pg";
import type { JobSystemConfig, QueueConfig } from "./types.js";

const cleanOrphanedJobs = async (opts: { connectionString: string; schema: string }) => {
  const pool = new Pool({ connectionString: opts.connectionString });
  try {
    const result = await pool.query<{ count: number }>(`
			WITH failed AS (
				UPDATE ${opts.schema}.job
				SET state = CASE
						WHEN retry_count < retry_limit THEN 'retry'::${opts.schema}.job_state
						ELSE 'failed'::${opts.schema}.job_state
					END,
					completed_on = now(),
					output = jsonb_build_object('message', 'worker restarted')
				WHERE state = 'active'
					AND started_on < now() - interval '10 seconds'
				RETURNING 1
			)
			SELECT count(*)::int AS count FROM failed
		`);
    const count = result.rows[0]?.count ?? 0;
    console.log(`[pg-boss] failed ${count} orphaned active jobs`);
  } finally {
    await pool.end();
  }
};

const ensureQueues = async (opts: { boss: PgBoss; queues: Record<string, QueueConfig> }) => {
  for (const [name, config] of Object.entries(opts.queues)) {
    const existing = await opts.boss.getQueue(name);
    if (!existing) {
      await opts.boss.createQueue(name);
      console.log(`[pg-boss] created queue: ${name}`);
    }

    const updateConfig: { expireInSeconds?: number; retryLimit?: number; retryDelay?: number } = {};
    if (config.expireInSeconds !== undefined) updateConfig.expireInSeconds = config.expireInSeconds;
    if (config.retryLimit !== undefined) updateConfig.retryLimit = config.retryLimit;
    if (config.retryDelay !== undefined) updateConfig.retryDelay = config.retryDelay;

    if (Object.keys(updateConfig).length > 0) {
      await opts.boss.updateQueue(name, updateConfig);
    }
  }
};

const registerWorkers = async (opts: {
  boss: PgBoss;
  queues: Record<string, QueueConfig>;
  handlers: Record<string, (data: unknown) => Promise<void>>;
}) => {
  for (const [name, config] of Object.entries(opts.queues)) {
    const handler = opts.handlers[name];

    if (!handler) {
      throw new Error(`[pg-boss] queue "${name}" has no handler.`);
    }

    const batchSize = config.batchSize ?? 1;
    const workOpts: { batchSize: number; includeMetadata: true; localConcurrency?: number } = {
      batchSize,
      includeMetadata: true,
    };
    if (config.localConcurrency !== undefined) workOpts.localConcurrency = config.localConcurrency;

    await opts.boss.work(name, workOpts, async (jobs) => {
      if (batchSize === 1) {
        const job = jobs[0]!;
        try {
          await handler(job.data);
        } catch (err) {
          if (config.onFailed && job.retryCount >= job.retryLimit) {
            await config.onFailed({ data: job.data, error: err });
          }
          throw err;
        }
      } else {
        const results = await Promise.allSettled(jobs.map((job) => handler(job.data)));
        const failed = results
          .map((r, i) => (r.status === "rejected" ? { job: jobs[i]!, reason: r.reason } : null))
          .filter((f) => f !== null);
        if (failed.length > 0) {
          if (config.onFailed) {
            await Promise.all(
              failed
                .filter((f) => f.job.retryCount >= f.job.retryLimit)
                .map((f) => config.onFailed!({ data: f.job.data, error: f.reason })),
            );
          }
          await opts.boss.fail(
            name,
            failed.map((f) => f.job.id),
          );
        }
      }
    });
  }
};

const registerSchedules = async (opts: {
  boss: PgBoss;
  schedules: JobSystemConfig["schedules"];
}) => {
  if (!opts.schedules?.length) return;

  for (const schedule of opts.schedules) {
    await opts.boss.schedule(schedule.queue, schedule.cron);
  }
};

const createInitJobs = (opts: {
  connectionString: string;
  schema: string;
  queues: Record<string, QueueConfig>;
  schedules?: JobSystemConfig["schedules"];
  cleanOrphans: boolean;
  getBoss: () => Promise<PgBoss>;
}) => {
  let initialized = false;

  const initJobs = async (handlers: Record<string, (data: unknown) => Promise<void>>) => {
    if (initialized) return;
    initialized = true;

    const boss = await opts.getBoss();

    if (opts.cleanOrphans) {
      await cleanOrphanedJobs({
        connectionString: opts.connectionString,
        schema: opts.schema,
      });
    }

    await ensureQueues({ boss, queues: opts.queues });
    await registerWorkers({ boss, queues: opts.queues, handlers });
    await registerSchedules({ boss, schedules: opts.schedules });

    console.log("[pg-boss] handlers registered");
  };

  return initJobs;
};

export { createInitJobs };
