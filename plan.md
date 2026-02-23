# sveltekit-pgboss — Implementation Plan

## What's Done

Project initialized and **core source code is written and builds cleanly**.

### Files created:
- `package.json` — scoped as `@justinyahin/sveltekit-pgboss`, configured for GitHub Packages
- `tsconfig.json`, `tsup.config.ts` — build config (ESM + CJS + .d.ts)
- `src/types.ts` — all shared types (`JobSystemConfig`, `QueueConfig`, `ScheduleConfig`, `QueueStats`, `JobInfo`, `DashboardData`)
- `src/boss.ts` — singleton pg-boss manager (`createBossManager`) with graceful shutdown
- `src/init.ts` — `createInitJobs` factory: orphan cleanup (raw SQL via pg), ensureQueues, worker registration, schedule registration
- `src/dashboard.ts` — `createDashboard`: queue stats (raw SQL), recent jobs (via `boss.findJobs`), rerun job
- `src/index.ts` — main export: `createJobSystem(config)` returns `{ getBoss, stopBoss, initJobs, dashboard }`


Make sure those match what we have in whatisthatmovie (/Users/iamsegbedji/work/projects/whatisthatmovie)

### Build output (`dist/`):
- `index.js` (ESM), `index.cjs` (CJS), `index.d.ts`, `index.d.cts`, sourcemaps — all clean, no warnings

---

## What's Left

### 1. Create CLAUDE.md
Carry over relevant conventions from `whatisthatmovie/CLAUDE.md`:
- Plan mode rules (concise, unresolved questions)
- TypeScript conventions (`type` not `interface`, exports at end, arrow functions, object args for multi-param)
- Bun as runtime/package manager
- Formatting/linting workflow (bun format, bunx eslint, type check)
- Token efficiency rules from melodle

Exclude project-specific stuff: SvelteKit routes, DB schemas, auth, migrations, env vars, shadcn.

Add package-specific notes:
- Build with `bun run build`
- This is a library package, not a SvelteKit app
- Test changes by linking into whatisthatmovie or melodle (`bun link`)

### 2. Create README.md
Should cover:
- What it does (one paragraph)
- Install via GitHub Packages (`.npmrc` setup + `bun add @justinyahin/sveltekit-pgboss`)
- API reference for `createJobSystem(config)` and returned objects
- Usage examples:
  - Define queues and handlers
  - `hooks.server.ts` integration (both in-process and separate worker patterns)
  - Remote functions for admin dashboard (show how to wrap `dashboard.getData()` and `dashboard.rerunJob()` in SvelteKit `query`/`command`)
  - Docker compose worker pattern (ENABLE_WORKER env var)
- Copy-pasteable admin page example (simplified Svelte component that uses the dashboard helpers) — keep it minimal/unstyled so it works regardless of design system

### 3. Init git repo
```bash
cd /Users/iamsegbedji/work/projects/sveltekit-pgboss
git init
# .gitignore already exists from bun init — verify it includes node_modules, dist, .env*
git add -A
git commit -m "Initial commit: core job system package"
```

### 4. Create GitHub repo + first publish
```bash
gh repo create JustinyAhin/sveltekit-pgboss --private --source=.
git push -u origin main
# Auth for GitHub Packages (needs a PAT with write:packages)
npm login --registry=https://npm.pkg.github.com
bun run build && npm publish
```

### 5. Test in whatisthatmovie
Replace the hand-rolled `src/lib/server/jobs/` files with the package:
- `bun add @justinyahin/sveltekit-pgboss` (after `.npmrc` points the scope to GitHub Packages)
- Refactor `src/lib/server/jobs/index.ts` to use `createJobSystem`
- Keep handlers as-is (they're project-specific)
- Refactor `jobs.remote.ts` to use `dashboard.getData()` / `dashboard.rerunJob()`
- Admin page stays as-is (project-specific UI)
- Delete `boss.ts`, `consts.ts` from whatisthatmovie (now provided by package)

### 6. (Optional) Future improvements
- Add `dashboard.cancelJob(queue, jobId)` helper
- Add a `sendJob(queue, data, opts?)` convenience wrapper that handles singleton keys
- Consider making `pg` a peer dependency instead of direct dependency (it's already pulled in by pg-boss)
- Add basic tests
