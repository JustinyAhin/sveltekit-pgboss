import { PgBoss } from "pg-boss";

type BossState = {
  instance: PgBoss | null;
  // Stored promise prevents concurrent getBoss() calls from creating multiple instances.
  starting: Promise<PgBoss> | null;
};

// Module-level flag so signal handlers are registered at most once,
// even if createBossManager is called multiple times in a process.
let signalHandlersRegistered = false;

const createBossManager = (opts: {
  connectionString: string;
  schema: string;
  onError: (err: Error) => void;
}) => {
  const state: BossState = { instance: null, starting: null };

  const getBoss = (): Promise<PgBoss> => {
    if (state.instance) return Promise.resolve(state.instance);
    if (state.starting) return state.starting;

    state.starting = (async () => {
      const instance = new PgBoss({
        connectionString: opts.connectionString,
        schema: opts.schema,
      });

      instance.on("error", opts.onError);
      await instance.start();
      console.log("[pg-boss] started");

      state.instance = instance;
      return instance;
    })();

    return state.starting;
  };

  const stopBoss = async () => {
    if (state.instance) {
      await state.instance.stop({ graceful: true });
      console.log("[pg-boss] stopped");
      state.instance = null;
      state.starting = null;
    }
  };

  if (!signalHandlersRegistered) {
    process.on("SIGINT", stopBoss);
    process.on("SIGTERM", stopBoss);
    signalHandlersRegistered = true;
  }

  return { getBoss, stopBoss };
};

export { createBossManager };
