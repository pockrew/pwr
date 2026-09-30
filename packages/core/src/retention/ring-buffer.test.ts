import { describe, expect, it } from "bun:test";

import type { WebhookEvent } from "@pockrew/pwr-shared/schemas";

import { createRingBuffer } from "./ring-buffer";

const createMockEvent = (id: string): WebhookEvent => ({
  id,
  tunnelId: "tun_test",
  orgId: "default",
  projectId: "default",
  method: "POST",
  headers: { "content-type": "application/json" },
  queryParams: {},
  body: JSON.stringify({ id }),
  status: 200,
  executionTimeMs: 1,
  createdAt: Date.now(),
});

describe("RingBuffer: Durability, Overflow & PeekBatch", () => {
  it("rejects new items when full when overwriteOnOverflow is false (default)", () => {
    const buffer = createRingBuffer(3, { overwriteOnOverflow: false });

    expect(buffer.push(createMockEvent("1"))).toBe(true);
    expect(buffer.push(createMockEvent("2"))).toBe(true);
    expect(buffer.push(createMockEvent("3"))).toBe(true);

    // Buffer is full (3/3): Next push must return false without dropping item 1
    expect(buffer.push(createMockEvent("4"))).toBe(false);
    expect(buffer.size()).toBe(3);

    // Verify oldest item is still item 1
    const oldest = buffer.peek();
    expect(oldest?.id).toBe("1");
  });

  it("overwrites oldest items when overwriteOnOverflow is true", () => {
    const buffer = createRingBuffer(3, { overwriteOnOverflow: true });

    buffer.push(createMockEvent("1"));
    buffer.push(createMockEvent("2"));
    buffer.push(createMockEvent("3"));

    // Overwrites item 1
    expect(buffer.push(createMockEvent("4"))).toBe(true);
    expect(buffer.size()).toBe(3);

    // Oldest is now item 2
    expect(buffer.peek()?.id).toBe("2");
  });

  it("peeks batches non-destructively and advances head pointer safely", () => {
    const buffer = createRingBuffer(5);

    buffer.push(createMockEvent("1"));
    buffer.push(createMockEvent("2"));
    buffer.push(createMockEvent("3"));

    // Non-destructive peek
    const batch = buffer.peekBatch(2);
    expect(batch.length).toBe(2);
    expect(batch[0]?.id).toBe("1");
    expect(batch[1]?.id).toBe("2");
    expect(buffer.size()).toBe(3); // Size still 3

    // Advance 2 items
    buffer.advance(2);
    expect(buffer.size()).toBe(1);
    expect(buffer.peek()?.id).toBe("3");
  });
});
