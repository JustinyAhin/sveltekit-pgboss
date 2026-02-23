# @segbedji/sveltekit-pgboss

A reusable [pg-boss](https://github.com/timgit/pg-boss) job system for SvelteKit projects. Provides a single factory function that sets up a pg-boss instance with queue management, worker registration, schedule registration, orphan cleanup, and a dashboard data layer — so you can drop background jobs into any SvelteKit app without re-writing the boilerplate.

## Install

```bash
npm install @segbedji/sveltekit-pgboss
# or
bun add @segbedji/sveltekit-pgboss
```

## Quick Start

```ts
import { createJobSystem, queue } from '@segbedji/sveltekit-pgboss';

const { send, initJobs } = createJobSystem({
  connectionString: process.env.DATABASE_URL!,
  queues: {
    'send-email': queue<{ to: string; subject: string }>({ retryLimit: 3 }),
    'generate-report': queue<{ type: string }>({ expireInSeconds: 3600 }),
  },
  schedules: [
    { queue: 'generate-report', cron: '0 8 * * 1' }, // every Monday 8 AM
  ],
});

// Initialize with handlers
await initJobs({
  'send-email': async (data) => {
    console.log('Sending email to', data.to);
  },
  'generate-report': async (data) => {
    console.log('Generating report', data.type);
  },
});

// Type-safe: queue name and payload are checked at compile time
await send({ name: 'send-email', data: { to: 'user@example.com', subject: 'Hello' } });

// TS error: 'nope' is not a valid queue name
await send({ name: 'nope', data: {} });

// TS error: wrong payload shape for 'send-email'
await send({ name: 'send-email', data: { type: 'weekly' } });
```

## API Reference

### `createJobSystem(config)`

Returns `{ send, getBoss, stopBoss, initJobs, dashboard }`.

#### Config

| Field | Type | Default | Description |
|---|---|---|---|
| `connectionString` | `string` | *required* | PostgreSQL connection string |
| `schema` | `string` | `'pgboss'` | pg-boss schema name |
| `queues` | `Record<string, QueueConfig<T>>` | *required* | Queue definitions created with `queue<T>()` |
| `schedules` | `ScheduleConfig[]` | `[]` | Cron schedules |
| `cleanOrphans` | `boolean` | `true` | Fail orphaned active jobs on startup |
| `onError` | `(err: Error) => void` | `console.error` | Error handler |

#### `queue<T>(config?)`

Creates a typed queue definition. The type parameter `T` defines the payload shape for `send()` and the handler.

```ts
import { queue } from '@segbedji/sveltekit-pgboss';

// With config
queue<{ to: string; subject: string }>({ retryLimit: 3, expireInSeconds: 3600 })

// Without config (defaults only)
queue<{ to: string }>()
```

| Field | Type | Default | Description |
|---|---|---|---|
| `batchSize` | `number` | `1` | Jobs per batch |
| `expireInSeconds` | `number` | pg-boss default | Job expiration |
| `retryLimit` | `number` | pg-boss default | Max retries |

#### Returned Object

| Property | Type | Description |
|---|---|---|
| `send` | `(opts: { name, data, options? }) => Promise<string \| null>` | Type-safe job sender — queue name and payload are validated at compile time |
| `getBoss` | `() => Promise<PgBoss>` | Get the raw pg-boss instance (starts it on first call) |
| `stopBoss` | `() => Promise<void>` | Graceful shutdown |
| `initJobs` | `(handlers) => Promise<void>` | Initialize: clean orphans, create queues, register workers & schedules. Handlers are required for every queue. |
| `dashboard.getData(limit?)` | `() => Promise<DashboardData>` | Queue stats + recent jobs |
| `dashboard.rerunJob({ queue, jobId })` | `() => Promise<{ queued: true }>` | Re-queue a job by ID |
| `dashboard.getStats()` | `() => Promise<QueueStats[]>` | Queue stats only |
| `dashboard.getRecentJobs(limit?)` | `() => Promise<JobInfo[]>` | Recent jobs only |

## Usage with SvelteKit

### Define your job system

Queue definitions and handlers live in separate files. This avoids circular imports when handlers need to call `send`.

```ts
// src/lib/server/jobs/system.ts — defines queues, exports send
import { createJobSystem, queue } from '@segbedji/sveltekit-pgboss';

const { send, getBoss, stopBoss, initJobs, dashboard } = createJobSystem({
  connectionString: process.env.DATABASE_URL!,
  queues: {
    'send-email': queue<{ to: string; subject: string }>({ retryLimit: 3 }),
    'generate-report': queue<{ type: string }>({
      expireInSeconds: 3600,
      retryLimit: 2,
    }),
  },
  schedules: [
    { queue: 'generate-report', cron: '0 8 * * 1' },
  ],
});

export { send, getBoss, stopBoss, initJobs, dashboard };
```

```ts
// src/lib/server/jobs/index.ts — wires handlers
import { initJobs } from './system';
import { handleSendEmail } from './handlers/send-email';
import { handleGenerateReport } from './handlers/generate-report';

const init = () =>
  initJobs({
    'send-email': handleSendEmail,
    'generate-report': handleGenerateReport,
  });

export { init as initJobs };
```

Handlers can safely import `send` from `system.ts` without creating a circular dependency:

```ts
// src/lib/server/jobs/handlers/send-email.ts
import { send } from '../system';

const handleSendEmail = async (data: { to: string; subject: string }) => {
  // ... can use send() to enqueue other jobs
};

export { handleSendEmail };
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
import { send } from '$lib/server/jobs/system';

// Type-safe: TS validates queue name and payload
await send({ name: 'send-email', data: { to: 'user@example.com', subject: 'Hello' } });
```

### Dashboard remote functions

Wrap the dashboard helpers in SvelteKit remote functions for your admin panel:

```ts
// src/lib/remote-functions/admin/jobs.remote.ts
import { command, query } from '$app/server';
import { dashboard } from '$lib/server/jobs/system';
import { z } from 'zod';

const getJobsDashboard = query(async () => {
  // Add your own auth check here
  return dashboard.getData();
});

const rerunJob = command(
  z.object({ queue: z.string(), jobId: z.string() }),
  async ({ queue, jobId }) => {
    // Add your own auth check here
    return dashboard.rerunJob({ queue, jobId });
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
  PayloadMap,
  HandlersMap,
  QueueConfig,
  ScheduleConfig,
  QueueStats,
  JobInfo,
  DashboardData,
} from '@segbedji/sveltekit-pgboss';
```

## License

MIT
