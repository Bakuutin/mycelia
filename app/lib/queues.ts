import { Job, Queue, Worker } from "bullmq";
import { redis } from "./redis.ts";

export function createQueue<T>(name: string): Queue<T> {
  return new Queue<T>(name, {
    connection: redis,
  });
}

export function createWorker<T>(
  queue: Queue<T>,
  handler: (job: Job<T>) => Promise<void>,
): Worker<T> {
  return new Worker<T>(queue.name, handler, {
    connection: redis,
  });
}
