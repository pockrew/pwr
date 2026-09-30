import type { WebhookEvent } from "@pockrew/pwr-shared/schemas";

export interface IQueuePort {
  push(event: WebhookEvent): boolean;
  pop(): WebhookEvent | undefined;
  peek(): WebhookEvent | undefined;
  peekBatch?(count?: number): readonly WebhookEvent[];
  advance?(count: number): void;
  size(): number;
  capacity(): number;
  drain(count?: number): readonly WebhookEvent[];
}
