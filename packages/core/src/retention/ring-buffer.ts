import type { IQueuePort } from "@core/ports/queue.port";

import type { WebhookEvent } from "@pockrew/pwr-shared/schemas";

export interface IRingBufferOptions {
  /** If true, overwrites the oldest items on capacity overflow. If false, rejects new items. Defaults to false. */
  overwriteOnOverflow?: boolean;
}

/**
 * Circular ring buffer for bounded-memory FIFO queueing.
 */
export class RingBuffer implements IQueuePort {
  private readonly buffer: Array<WebhookEvent | undefined>;
  private readonly maxCapacity: number;
  private readonly overwriteOnOverflow: boolean;
  private headIndex = 0;
  private tailIndex = 0;
  private currentCount = 0;

  constructor(capacity = 1000, options?: IRingBufferOptions) {
    const safeCapacity = capacity > 0 ? capacity : 1000;
    this.maxCapacity = safeCapacity;
    this.overwriteOnOverflow = options?.overwriteOnOverflow ?? false;
    this.buffer = Array.from<WebhookEvent | undefined>({ length: safeCapacity });
  }

  /**
   * Pushes a new item into the ring buffer.
   * If capacity is reached, overwrites oldest if overwriteOnOverflow is true, or returns false if false.
   */
  public push = (event: WebhookEvent): boolean => {
    // 1. Check capacity threshold
    if (this.currentCount >= this.maxCapacity) {
      if (!this.overwriteOnOverflow) {
        return false;
      }
      // Overwrite oldest item: advance head
      this.headIndex = (this.headIndex + 1) % this.maxCapacity;
    } else {
      this.currentCount += 1;
    }

    // 2. Store item at current tail pointer and advance modulo capacity
    this.buffer[this.tailIndex] = event;
    this.tailIndex = (this.tailIndex + 1) % this.maxCapacity;
    return true;
  };

  /**
   * Pops the oldest item from the buffer.
   */
  public pop = (): WebhookEvent | undefined => {
    // 1. Return undefined if buffer is empty
    if (this.currentCount === 0) return undefined;

    // 2. Read item at head pointer and clear reference
    const item = this.buffer[this.headIndex];
    this.buffer[this.headIndex] = undefined;

    // 3. Advance head pointer and decrement count
    this.headIndex = (this.headIndex + 1) % this.maxCapacity;
    this.currentCount -= 1;
    return item;
  };

  /**
   * Peeks at the oldest item without removing it.
   */
  public peek = (): WebhookEvent | undefined => {
    if (this.currentCount === 0) return undefined;
    return this.buffer[this.headIndex];
  };

  /**
   * Peeks at up to `count` items from head without removing them.
   *
   * @param count - Optional maximum number of items to peek.
   * @returns Readonly array of peeked events.
   */
  public peekBatch = (count?: number): readonly WebhookEvent[] => {
    // 1. Calculate bounded limit to peek
    const limit =
      typeof count === "number" && count > 0
        ? Math.min(count, this.currentCount)
        : this.currentCount;
    const result: WebhookEvent[] = [];

    // 2. Iterate circular buffer items from headIndex without consuming
    for (let i = 0; i < limit; i += 1) {
      const idx = (this.headIndex + i) % this.maxCapacity;
      const item = this.buffer[idx];
      if (item) {
        result.push(item);
      }
    }

    // 3. Return snapshot array
    return result;
  };

  /**
   * Advances head pointer by `count` items, clearing references and reducing size.
   *
   * @param count - Number of items committed and to discard from head.
   */
  public advance = (count: number): void => {
    // 1. Bound advance count to current buffer count
    const advanceCount = Math.min(Math.max(0, count), this.currentCount);

    // 2. Clear element references and advance head pointer modulo maxCapacity
    for (let i = 0; i < advanceCount; i += 1) {
      this.buffer[this.headIndex] = undefined;
      this.headIndex = (this.headIndex + 1) % this.maxCapacity;
      this.currentCount -= 1;
    }
  };

  /**
   * Returns the current number of events buffered in memory.
   *
   * @returns Current buffered count.
   */
  public size = (): number => this.currentCount;

  /**
   * Returns the maximum capacity allocated for the circular buffer.
   *
   * @returns Buffer maximum capacity.
   */
  public capacity = (): number => this.maxCapacity;

  /**
   * Drains up to `count` items from the buffer into an array.
   */
  public drain = (count?: number): readonly WebhookEvent[] => {
    // 1. Calculate bounded limit to drain
    const drainLimit =
      typeof count === "number" && count > 0
        ? Math.min(count, this.currentCount)
        : this.currentCount;
    const result: WebhookEvent[] = [];

    // 2. Sequentially pop items into results array
    for (let i = 0; i < drainLimit; i += 1) {
      const item = this.pop();
      if (item) {
        result.push(item);
      }
    }

    // 3. Return drained items
    return result;
  };
}

/**
 * Factory creating a circular memory RingBuffer instance for buffering webhook events.
 *
 * @param capacity - Maximum number of items the ring buffer will hold before dropping or saturating.
 * @param options - Optional configuration options controlling saturation and drop policy.
 * @returns New RingBuffer instance.
 */
export const createRingBuffer = (capacity?: number, options?: IRingBufferOptions): RingBuffer =>
  new RingBuffer(capacity, options);
