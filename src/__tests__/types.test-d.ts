import { expectTypeOf, describe, it } from "vitest";
import { queue, createJobSystem } from "../index.js";
import type { PayloadMap, HandlersMap, QueueConfig } from "../types.js";

describe("type-level tests", () => {
  it("queue<T>() returns QueueConfig<T>", () => {
    const emailQueue = queue<{ to: string }>({ retryLimit: 3 });
    expectTypeOf(emailQueue).toEqualTypeOf<QueueConfig<{ to: string }>>();
  });

  it("PayloadMap extracts phantom types correctly", () => {
    type Queues = {
      email: QueueConfig<{ to: string }>;
      sms: QueueConfig<{ phone: number }>;
    };
    type Payloads = PayloadMap<Queues>;

    expectTypeOf<Payloads["email"]>().toEqualTypeOf<{ to: string }>();
    expectTypeOf<Payloads["sms"]>().toEqualTypeOf<{ phone: number }>();
  });

  it("HandlersMap produces correct handler signatures", () => {
    type Queues = {
      email: QueueConfig<{ to: string }>;
      sms: QueueConfig<{ phone: number }>;
    };
    type Handlers = HandlersMap<Queues>;

    expectTypeOf<Handlers["email"]>().toEqualTypeOf<(data: { to: string }) => Promise<void>>();
    expectTypeOf<Handlers["sms"]>().toEqualTypeOf<(data: { phone: number }) => Promise<void>>();
  });

  it("send() enforces correct payload per queue name", () => {
    const system = createJobSystem({
      connectionString: "postgres://localhost/test",
      queues: {
        email: queue<{ to: string }>(),
        sms: queue<{ phone: number }>(),
      },
    });

    expectTypeOf(system.send).parameter(0).toHaveProperty("data");
  });
});
