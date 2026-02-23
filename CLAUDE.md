# sveltekit-pgboss

Reusable pg-boss job system for SvelteKit projects. This is a **library package**, not a SvelteKit app.

## Plan Mode

- Make the plan extremely concise. Sacrifice grammar for the sake of concision.
- At the end of each plan, give me a list of unresolved questions to answer, if any.

## Tech Stack

- **Runtime/Package Manager**: Bun (not npm/pnpm)
- **Build**: tsup (ESM + CJS + .d.ts)
- **Language**: TypeScript (strict)
- **Dependencies**: pg-boss, pg

## Code Conventions

### TypeScript

- Use `type` instead of `interface`
- All exports at the end of the file, not inline
- Use arrow functions instead of function declarations
- Functions with more than one parameter should use object arguments
- Keep types in `src/types.ts`

### Token Efficiency

- **Never re-read a file you just edited.** You already know its contents.
- **Batch all formatting/linting at the end**, not after each file.
- **Before using Edit, verify the exact string exists** in what you already read.

## Commands

```bash
bun run build        # Build with tsup (ESM + CJS + .d.ts)
bun link             # Link locally for testing in other projects
```

## Testing Changes

No test suite yet. Test by linking into a consumer project:

```bash
# In this package
bun link

# In the consumer project (e.g. whatisthatmovie)
bun link @justinyahin/sveltekit-pgboss
```

## Publishing

Published to GitHub Packages under `@justinyahin/sveltekit-pgboss`.

```bash
bun run build && npm publish
```
