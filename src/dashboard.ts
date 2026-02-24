import { Pool } from "pg";
import type { CreateDashboardOpts, DashboardData, JobInfo, QueueStats } from "./types.js";

// Raw SQL is used instead of pg-boss APIs because pg-boss has no aggregation/stats queries.
const createDashboard = (opts: CreateDashboardOpts) => {
  // Lazy singleton pool — reused across all dashboard calls to avoid per-request connection overhead.
  let pool: Pool | null = null;
  const getPool = () => {
    if (!pool) pool = new Pool({ connectionString: opts.connectionString });
    return pool;
  };

  // pg-boss uses a Postgres enum where 'created' < 'active', so state < 'active' catches queued jobs.
  const getStats = async (): Promise<QueueStats[]> => {
    const result = await getPool().query<QueueStats>(
      `
				SELECT
					q.name,
			coalesce((count(*) FILTER (WHERE j.state < 'active' AND j.start_after <= now()))::int, 0) AS "queuedCount",
					coalesce((count(*) FILTER (WHERE j.state = 'active'))::int, 0) AS "activeCount",
					coalesce((count(*) FILTER (WHERE j.start_after > now()))::int, 0) AS "deferredCount",
					coalesce((count(j.id))::int, 0) AS "totalCount"
				FROM unnest($1::text[]) AS q(name)
				LEFT JOIN ${opts.schema}.job j ON j.name = q.name
				GROUP BY q.name
				ORDER BY q.name
				`,
      [opts.queueNames],
    );
    return result.rows;
  };

  const getRecentJobs = async (limit = 50): Promise<JobInfo[]> => {
    const result = await getPool().query<JobInfo>(
      `
				SELECT
					id, name, state,
					data,
					created_on AS "createdOn",
					started_on AS "startedOn",
					completed_on AS "completedOn",
					retry_count AS "retryCount",
					retry_limit AS "retryLimit",
					singleton_key AS "singletonKey",
					output
				FROM ${opts.schema}.job
				WHERE name = ANY($1)
				ORDER BY created_on DESC
				LIMIT $2
				`,
      [opts.queueNames, limit],
    );
    return result.rows;
  };

  const getData = async (limit = 50): Promise<DashboardData> => {
    const [queues, jobs] = await Promise.all([getStats(), getRecentJobs(limit)]);
    return { queues, jobs };
  };

  const rerunJob = async ({ queue, jobId }: { queue: string; jobId: string }) => {
    const boss = await opts.getBoss();
    const [job] = await boss.findJobs(queue, { id: jobId });
    if (!job) throw new Error(`Job ${jobId} not found in queue ${queue}`);

    await boss.send(queue, job.data as object);
    return { queued: true };
  };

  return { getStats, getRecentJobs, getData, rerunJob };
};

export { createDashboard };
