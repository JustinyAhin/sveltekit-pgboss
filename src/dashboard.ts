import { Pool } from "pg";
import type { AnyJob, CreateDashboardOpts, DashboardData, JobInfo, QueueStats } from "./types.js";

const createDashboard = (opts: CreateDashboardOpts) => {
  const getStats = async (): Promise<QueueStats[]> => {
    const pool = new Pool({ connectionString: opts.connectionString });
    try {
      const result = await pool.query<QueueStats>(
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
    } finally {
      await pool.end();
    }
  };

  const getRecentJobs = async (limit = 50): Promise<JobInfo[]> => {
    const boss = await opts.getBoss();

    const jobsByQueue = await Promise.all(opts.queueNames.map((name) => boss.findJobs(name)));

    return (jobsByQueue.flat() as AnyJob[])
      .sort((a, b) => new Date(b.createdOn).getTime() - new Date(a.createdOn).getTime())
      .slice(0, limit)
      .map((j) => ({
        id: j.id,
        name: j.name,
        state: j.state,
        data: j.data as Record<string, unknown>,
        createdOn: j.createdOn,
        startedOn: j.startedOn,
        completedOn: j.completedOn,
        retryCount: j.retryCount,
        retryLimit: j.retryLimit,
        singletonKey: j.singletonKey,
        output: j.output,
      }));
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
