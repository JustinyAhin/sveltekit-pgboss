import { beforeEach, describe, expect, it, vi } from "vitest";

describe("createBossManager", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.resetModules();
    });

    it("allows retrying getBoss after a startup failure", async () => {
        const startMock = vi
            .fn()
            .mockRejectedValueOnce(new Error("start failed"))
            .mockResolvedValue(undefined);
        const stopMock = vi.fn().mockResolvedValue(undefined);
        const onMock = vi.fn();

        vi.doMock("pg-boss", () => {
            class MockPgBoss {
                on = onMock;
                start = startMock;
                stop = stopMock;
                constructor(_opts: unknown) {}
            }
            return { PgBoss: MockPgBoss };
        });

        const { createBossManager } = await import("../boss.js");
        const manager = createBossManager({
            connectionString: "postgres://localhost/test",
            schema: "pgboss",
            onError: vi.fn(),
        });

        await expect(manager.getBoss()).rejects.toThrow("start failed");
        await expect(manager.getBoss()).resolves.toBeDefined();
        expect(startMock).toHaveBeenCalledTimes(2);
    });

    it("stops all created managers when a signal is received", async () => {
        const startMock = vi.fn().mockResolvedValue(undefined);
        const stopMock = vi.fn().mockResolvedValue(undefined);

        vi.doMock("pg-boss", () => {
            class MockPgBoss {
                on = vi.fn();
                start = startMock;
                stop = stopMock;
                constructor(_opts: unknown) {}
            }
            return { PgBoss: MockPgBoss };
        });

        const processOnSpy = vi.spyOn(process, "on");
        const { createBossManager } = await import("../boss.js");

        const managerOne = createBossManager({
            connectionString: "postgres://localhost/test",
            schema: "pgboss",
            onError: vi.fn(),
        });
        const managerTwo = createBossManager({
            connectionString: "postgres://localhost/test",
            schema: "pgboss",
            onError: vi.fn(),
        });

        await managerOne.getBoss();
        await managerTwo.getBoss();

        const sigintHandler = processOnSpy.mock.calls.find((call) => call[0] === "SIGINT")?.[1];
        expect(sigintHandler).toBeTypeOf("function");

        (sigintHandler as () => void)();
        await Promise.resolve();
        await Promise.resolve();

        expect(stopMock).toHaveBeenCalledTimes(2);
        expect(processOnSpy.mock.calls.filter((call) => call[0] === "SIGINT")).toHaveLength(1);
        expect(processOnSpy.mock.calls.filter((call) => call[0] === "SIGTERM")).toHaveLength(1);
    });
});
