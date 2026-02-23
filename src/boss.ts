import { PgBoss } from "pg-boss";

type BossState = {
  instance: PgBoss | null;
  starting: Promise<PgBoss> | null;
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

  process.on("SIGINT", stopBoss);
  process.on("SIGTERM", stopBoss);

  return { getBoss, stopBoss };
};

export { createBossManager };
