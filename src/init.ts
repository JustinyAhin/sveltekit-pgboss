import type { PgBoss } from "pg-boss";
import { Pool } from "pg";
import type { JobSystemConfig, QueueConfig } from "./types.js";

const normalizeError = (error: unknown): Error => {
  if (error instanceof Error) return error;
  return new Error(String(error));
};

// On server restart, jobs left in 'active' state are orphaned (no worker will complete them).
// This moves them to 'retry' (if retries remain) or 'failed'. The 10-second window avoids
// touching jobs that were legitimately just picked up by another worker before the restart.
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

// Only expireInSeconds, retryLimit, and retryDelay are persisted to the queue (DB-level settings).
// batchSize, localConcurrency, and onFailed are worker-side options, applied in registerWorkers.
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
  handlers: Record<string, (data: unknown) => Promise<unknown>>;
  onError?: (err: Error) => void;
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
      // Single-job path: re-throw so pg-boss handles retry/fail state automatically.
      if (batchSize === 1) {
        const job = jobs[0]!;
        try {
          await handler(job.data);
        } catch (error) {
          if (config.onFailed && job.retryCount >= job.retryLimit) {
            await config.onFailed({ data: job.data, error });
          }
          throw error;
        }
      } else {
        // Batch path: pg-boss gives us the whole batch in one callback, so we must
        // explicitly fail individual jobs — re-throwing would fail the entire batch.
        const results = await Promise.allSettled(jobs.map((job) => handler(job.data)));
        const failed = results
          .map((result, index) =>
            result.status === "rejected" ? { job: jobs[index]!, reason: result.reason } : null,
          )
          .filter((entry) => entry !== null);

        if (failed.length > 0) {
          if (config.onFailed) {
            const exhausted = failed.filter(
              (entry) => entry.job.retryCount >= entry.job.retryLimit,
            );
            const onFailedResults = await Promise.allSettled(
              exhausted.map((entry) =>
                config.onFailed!({ data: entry.job.data, error: entry.reason }),
              ),
            );
            onFailedResults.forEach((result, index) => {
              if (result.status === "rejected") {
                const jobId = exhausted[index]?.job.id ?? "unknown";
                const hookError = normalizeError(result.reason);
                opts.onError?.(
                  new Error(
                    `[pg-boss] onFailed hook failed for queue "${name}" and job "${jobId}": ${hookError.message}`,
                  ),
                );
              }
            });
          }
          await opts.boss.fail(
            name,
            failed.map((entry) => entry.job.id),
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
  onError?: (err: Error) => void;
}) => {
  // Guard against double-initialization (e.g. HMR in dev or multiple hook calls).
  let initialized = false;
  let initializing: Promise<void> | null = null;

  const initJobs = async (handlers: Record<string, (data: unknown) => Promise<unknown>>) => {
    if (initialized) return;
    if (initializing) {
      await initializing;
      return;
    }

    initializing = (async () => {
      const boss = await opts.getBoss();

      if (opts.cleanOrphans) {
        await cleanOrphanedJobs({
          connectionString: opts.connectionString,
          schema: opts.schema,
        });
      }

      await ensureQueues({ boss, queues: opts.queues });
      await registerWorkers({ boss, queues: opts.queues, handlers, onError: opts.onError });
      await registerSchedules({ boss, schedules: opts.schedules });

      initialized = true;
      console.log("[pg-boss] handlers registered");
    })();

    try {
      await initializing;
    } finally {
      initializing = null;
    }
  };

  return initJobs;
};

export { createInitJobs };
