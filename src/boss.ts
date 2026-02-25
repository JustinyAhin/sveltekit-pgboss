import { PgBoss } from "pg-boss";

type BossState = {
  instance: PgBoss | null;
  // Stored promise prevents concurrent getBoss() calls from creating multiple instances.
  starting: Promise<PgBoss> | null;
};

// Module-level flag so signal handlers are registered at most once,
// even if createBossManager is called multiple times in a process.
let signalHandlersRegistered = false;
const stopCallbacks = new Set<() => Promise<void>>();

const registerSignalHandlers = () => {
  if (signalHandlersRegistered) return;

  const handleSignal = () => {
    const callbacks = Array.from(stopCallbacks);
    void Promise.allSettled(callbacks.map((stop) => stop()));
  };

  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);
  signalHandlersRegistered = true;
};

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
      try {
        await instance.start();
        console.log("[pg-boss] started");
        state.instance = instance;
        return instance;
      } catch (error) {
        state.starting = null;
        throw error;
      }
    })();

    return state.starting;
  };

  const stopBoss = async () => {
    if (!state.instance && state.starting) {
      try {
        await state.starting;
      } catch {
        return;
      }
    }

    if (state.instance) {
      await state.instance.stop({ graceful: true });
      console.log("[pg-boss] stopped");
      state.instance = null;
    }
    state.starting = null;
  };

  registerSignalHandlers();
  stopCallbacks.add(stopBoss);

  return { getBoss, stopBoss };
};

export { createBossManager };
