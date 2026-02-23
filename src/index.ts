import { createBossManager } from './boss.js';
import { createInitJobs } from './init.js';
import { createDashboard } from './dashboard.js';
import type { JobSystemConfig } from './types.js';

const createJobSystem = (config: JobSystemConfig) => {
	const schema = config.schema ?? 'pgboss';
	const onError = config.onError ?? ((err: Error) => console.error('[pg-boss] error:', err));

	const { getBoss, stopBoss } = createBossManager({
		connectionString: config.connectionString,
		schema,
		onError
	});

	const initJobs = createInitJobs({
		connectionString: config.connectionString,
		schema,
		queues: config.queues,
		schedules: config.schedules,
		cleanOrphans: config.cleanOrphans ?? true,
		getBoss
	});

	const queueNames = Object.keys(config.queues);

	const dashboard = createDashboard({
		connectionString: config.connectionString,
		schema,
		queueNames,
		getBoss
	});

	return { getBoss, stopBoss, initJobs, dashboard };
};

export { createJobSystem };
export type {
	JobSystemConfig,
	QueueConfig,
	ScheduleConfig,
	QueueStats,
	JobInfo,
	DashboardData
} from './types.js';
