import { describe, expect, it, vi } from "vitest";
import { queueManualTrigger } from "../src/index";

describe("queueManualTrigger", () => {
  it("queues the run in waitUntil and returns an accepted response immediately", async () => {
    const task = vi.fn().mockResolvedValue(undefined);
    const waitUntil = vi.fn((promise: Promise<unknown>) => promise);
    const response = queueManualTrigger({ waitUntil } as unknown as ExecutionContext, task);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ ok: true, queued: true });
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(task).toHaveBeenCalledTimes(1);
  });
});
