# @justinyahin/sveltekit-pgboss

A reusable [pg-boss](https://github.com/timgit/pg-boss) job system for SvelteKit projects. Provides a single factory function that sets up a pg-boss instance with queue management, worker registration, schedule registration, orphan cleanup, and a dashboard data layer — so you can drop background jobs into any SvelteKit app without re-writing the boilerplate.

## Install

This package is published to GitHub Packages.

**1. Configure your `.npmrc`** (in your consuming project root):

```
@justinyahin:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

**2. Install:**

```bash
bun add @justinyahin/sveltekit-pgboss
```

## Quick Start

```ts
import { createJobSystem } from '@justinyahin/sveltekit-pgboss';

const { getBoss, stopBoss, initJobs, dashboard } = createJobSystem({
  connectionString: process.env.DATABASE_URL!,
  queues: {
    'send-email': {
      handler: async (data) => {
        console.log('Sending email to', data.to);
      },
      retryLimit: 3,
    },
    'generate-report': {
      handler: async (data) => {
        console.log('Generating report', data.type);
      },
      expireInSeconds: 3600,
    },
  },
  schedules: [
    { queue: 'generate-report', cron: '0 8 * * 1' }, // every Monday 8 AM
  ],
});
```

## API Reference

### `createJobSystem(config)`

Returns `{ getBoss, stopBoss, initJobs, dashboard }`.

#### Config

| Field | Type | Default | Description |
|---|---|---|---|
| `connectionString` | `string` | *required* | PostgreSQL connection string |
| `schema` | `string` | `'pgboss'` | pg-boss schema name |
| `queues` | `Record<string, QueueConfig>` | *required* | Queue definitions with handlers |
| `schedules` | `ScheduleConfig[]` | `[]` | Cron schedules |
| `cleanOrphans` | `boolean` | `true` | Fail orphaned active jobs on startup |
| `onError` | `(err: Error) => void` | `console.error` | Error handler |

#### QueueConfig

| Field | Type | Default | Description |
|---|---|---|---|
| `handler` | `(data: T) => Promise<void>` | *required* | Job handler function |
| `batchSize` | `number` | `1` | Jobs per batch |
| `expireInSeconds` | `number` | pg-boss default | Job expiration |
| `retryLimit` | `number` | pg-boss default | Max retries |
| `retryDelay` | `number` | pg-boss default | Delay between retries (seconds) |

#### Returned Object

| Property | Type | Description |
|---|---|---|
| `getBoss` | `() => Promise<PgBoss>` | Get the pg-boss instance (starts it on first call) |
| `stopBoss` | `() => Promise<void>` | Graceful shutdown |
| `initJobs` | `() => Promise<void>` | Initialize: clean orphans, create queues, register workers & schedules |
| `dashboard.getData(limit?)` | `() => Promise<DashboardData>` | Queue stats + recent jobs |
| `dashboard.rerunJob(queue, jobId)` | `() => Promise<{ queued: true }>` | Re-queue a job by ID |
| `dashboard.getStats()` | `() => Promise<QueueStats[]>` | Queue stats only |
| `dashboard.getRecentJobs(limit?)` | `() => Promise<JobInfo[]>` | Recent jobs only |

## Usage with SvelteKit

### Define your job system

```ts
// src/lib/server/jobs/index.ts
import { createJobSystem } from '@justinyahin/sveltekit-pgboss';
import { handleSendEmail } from './handlers/send-email.js';
import { handleGenerateReport } from './handlers/generate-report.js';

const { getBoss, stopBoss, initJobs, dashboard } = createJobSystem({
  connectionString: process.env.DATABASE_URL!,
  queues: {
    'send-email': {
      handler: handleSendEmail,
      retryLimit: 3,
    },
    'generate-report': {
      handler: handleGenerateReport,
      expireInSeconds: 3600,
      retryLimit: 2,
    },
  },
  schedules: [
    { queue: 'generate-report', cron: '0 8 * * 1' },
  ],
});

export { getBoss, stopBoss, initJobs, dashboard };
```

### Start workers in `hooks.server.ts`

```ts
// src/hooks.server.ts
import { initJobs } from '$lib/server/jobs';
import { building } from '$app/environment';

export const init = async () => {
  if (!building && process.env.ENABLE_WORKER === 'true') {
    await initJobs();
  }
};
```

Set `ENABLE_WORKER=true` on the process that should run workers. This lets you run workers in-process during development and in a separate container in production.

### Send jobs from anywhere

```ts
import { getBoss } from '$lib/server/jobs';

const boss = await getBoss();
await boss.send('send-email', { to: 'user@example.com', subject: 'Hello' });
```

### Dashboard remote functions

Wrap the dashboard helpers in SvelteKit remote functions for your admin panel:

```ts
// src/lib/remote-functions/admin/jobs.remote.ts
import { command, query } from '$app/server';
import { dashboard } from '$lib/server/jobs';
import { z } from 'zod';

const getJobsDashboard = query(async () => {
  // Add your own auth check here
  return dashboard.getData();
});

const rerunJob = command(
  z.object({ queue: z.string(), jobId: z.string() }),
  async ({ queue, jobId }) => {
    // Add your own auth check here
    return dashboard.rerunJob(queue, jobId);
  }
);

export { getJobsDashboard, rerunJob };
```

### Admin page example

A minimal admin page using the remote functions above:

```svelte
<!-- src/routes/admin/jobs/+page.svelte -->
<script lang="ts">
  import { getJobsDashboard, rerunJob } from '$lib/remote-functions/admin/jobs.remote';

  let data = $state(getJobsDashboard());

  const handleRerun = async (queue: string, jobId: string) => {
    await rerunJob({ queue, jobId });
    data = getJobsDashboard();
  };
</script>

{#await data}
  <p>Loading...</p>
{:then { queues, jobs }}
  <h2>Queues</h2>
  <table>
    <thead>
      <tr><th>Queue</th><th>Queued</th><th>Active</th><th>Deferred</th><th>Total</th></tr>
    </thead>
    <tbody>
      {#each queues as q}
        <tr>
          <td>{q.name}</td>
          <td>{q.queuedCount}</td>
          <td>{q.activeCount}</td>
          <td>{q.deferredCount}</td>
          <td>{q.totalCount}</td>
        </tr>
      {/each}
    </tbody>
  </table>

  <h2>Recent Jobs</h2>
  <table>
    <thead>
      <tr><th>ID</th><th>Queue</th><th>State</th><th>Created</th><th>Actions</th></tr>
    </thead>
    <tbody>
      {#each jobs as job}
        <tr>
          <td>{job.id.slice(0, 8)}</td>
          <td>{job.name}</td>
          <td>{job.state}</td>
          <td>{new Date(job.createdOn).toLocaleString()}</td>
          <td>
            {#if job.state === 'failed' || job.state === 'completed'}
              <button onclick={() => handleRerun(job.name, job.id)}>Rerun</button>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/await}
```

### Docker Compose worker pattern

Run workers separately from your web server:

```yaml
# docker-compose.yml
services:
  web:
    build: .
    environment:
      - ENABLE_WORKER=false

  worker:
    build: .
    environment:
      - ENABLE_WORKER=true
```

## Types

All types are exported:

```ts
import type {
  JobSystemConfig,
  QueueConfig,
  ScheduleConfig,
  QueueStats,
  JobInfo,
  DashboardData,
} from '@justinyahin/sveltekit-pgboss';
```

## License

MIT
