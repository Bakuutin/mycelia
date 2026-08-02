import { getQueue } from "./queue.ts";

/**
 * Manages worker pause state. Uses BullMQ queue pause/resume under the hood.
 * In-memory state is kept for fast isPaused() checks.
 */
class WorkerPauseManager {
  private pausedWorkers = new Set<string>();

  /**
   * Pause a worker - it will stop processing new jobs.
   * Existing jobs will complete.
   */
  async pauseWorker(workerType: string): Promise<void> {
    const queue = getQueue(workerType);
    await queue.pause();
    this.pausedWorkers.add(workerType);
    console.log(`[WorkerPauseManager] Paused worker: ${workerType}`);
  }

  /**
   * Resume a worker - it will start processing new jobs again.
   */
  async resumeWorker(workerType: string): Promise<void> {
    const queue = getQueue(workerType);
    await queue.resume();
    this.pausedWorkers.delete(workerType);
    console.log(`[WorkerPauseManager] Resumed worker: ${workerType}`);
  }

  /**
   * Check if a worker is currently paused.
   */
  isPaused(workerType: string): boolean {
    return this.pausedWorkers.has(workerType);
  }

  /** Read the durable BullMQ pause flag and reconcile the in-memory cache. */
  async getEffectivePauseState(workerType: string): Promise<boolean> {
    const paused = await getQueue(workerType).isPaused();
    if (paused) this.pausedWorkers.add(workerType);
    else this.pausedWorkers.delete(workerType);
    return paused;
  }

  /**
   * Apply one pause state to several queues. If one operation fails, restore
   * every queue already changed to the state observed before this request.
   */
  async setWorkersPaused(
    workerTypes: string[],
    paused: boolean,
  ): Promise<Record<string, { paused: boolean }>> {
    const before = new Map<string, boolean>();
    const changed: string[] = [];
    try {
      for (const workerType of workerTypes) {
        const current = await this.getEffectivePauseState(workerType);
        before.set(workerType, current);
        if (current === paused) continue;
        if (paused) await this.pauseWorker(workerType);
        else await this.resumeWorker(workerType);
        changed.push(workerType);
      }
    } catch (error) {
      for (const workerType of changed.reverse()) {
        const previous = before.get(workerType) ?? false;
        if (previous) await this.pauseWorker(workerType);
        else await this.resumeWorker(workerType);
      }
      throw error;
    }

    return Object.fromEntries(
      workerTypes.map((workerType) => [workerType, { paused }]),
    );
  }

  /**
   * Get all paused worker types.
   */
  getPausedWorkers(): string[] {
    return Array.from(this.pausedWorkers);
  }

  /**
   * Initialize pause state from config.
   * Call this on server startup after workers are created.
   */
  async initFromConfig(
    workersConfig: Record<string, { paused?: boolean }>,
  ): Promise<void> {
    for (const [workerType, config] of Object.entries(workersConfig)) {
      if (config.paused) {
        await this.pauseWorker(workerType);
      } else {
        // BullMQ pause state is persisted in Redis. Reconcile both directions
        // so a queue cannot remain paused after the config was changed while
        // the backend was offline or interrupted during persistence.
        await this.resumeWorker(workerType);
      }
    }

    const pausedCount = this.pausedWorkers.size;
    if (pausedCount > 0) {
      console.log(
        `[WorkerPauseManager] Restored ${pausedCount} paused worker(s) from config`,
      );
    }
  }
}

export const workerPauseManager = new WorkerPauseManager();
