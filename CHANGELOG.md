# Changelog

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
