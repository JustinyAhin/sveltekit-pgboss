# Changelog

## 0.0.8-beta.0

### Breaking Changes

- **`dashboard.getData()` and `dashboard.getRecentJobs()` signatures changed** — both now accept `{ page?, perPage? }` instead of a plain `limit` number. `getRecentJobs` returns `{ jobs, pagination }` instead of a flat `JobInfo[]`. `DashboardData` now includes a `pagination` field.

### Features

- Add pagination support to `dashboard.getData()` and `dashboard.getRecentJobs()` with `page`/`perPage` params, total count query, and `PaginationInfo` in the response
- Allow handlers to return values — `HandlersMap` return type changed from `Promise<void>` to `Promise<unknown>` (pg-boss stores the return value as job output)
- Export `PaginationInfo` type

### Testing

- Add dashboard test suite (5 tests covering pagination defaults, offset computation, zero-job edge case, getData integration)

## 0.0.7-beta.0

### Bug Fixes

- Wire `retryDelay` into `QueueConfig` and `ensureQueues` — was defined in docs but never applied (#1)
- Reuse `pg.Pool` across `getStats()` calls in dashboard — was creating a new pool on every call (#2)
- Guard signal handler registration with module-level flag — duplicate handlers when creating multiple job systems (#4)
- Handle partial batch failures with `Promise.allSettled` — `batchSize > 1` no longer fails the entire batch if one job throws (#5)

### Performance

- Replace per-queue `findJobs` fan-out in `getRecentJobs` with a single SQL query (#3)

### Features

- Add optional `onFailed` callback to `QueueConfig` for jobs that exhaust all retries (#6)
- Expose `localConcurrency` in `QueueConfig`

### Testing

- Add unit test suite with vitest (8 tests covering worker registration, batch/retry logic, orphan cleanup, idempotency)
- Add type-level tests for phantom types, `PayloadMap`, `HandlersMap`, and `send()` type safety
