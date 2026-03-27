import { Logger } from './logger.js';

export interface MemoryStats {
  heapUsedMB: number;
  heapTotalMB: number;
  percentUsed: number;
  warning: boolean;
}

export class MemoryMonitor {
  private warningThreshold: number;
  private maxHeapMB: number;
  private logger: Logger;

  constructor(logger: Logger, maxHeapMB?: number, warningThreshold: number = 0.8) {
    this.logger = logger;
    this.maxHeapMB = maxHeapMB || this.getDefaultHeap();
    this.warningThreshold = warningThreshold;
  }

  /**
   * Get default heap size from Node.js or system
   */
  private getDefaultHeap(): number {
    // Try to get from v8 if available
    try {
      const v8 = require('v8');
      const heapStats = v8.getHeapStatistics();
      return Math.round(heapStats.heap_size_limit / 1024 / 1024);
    } catch {
      // Fallback: default Node.js heap is ~1.4 GB on 64-bit systems
      return 1400;
    }
  }

  /**
   * Check current memory usage
   */
  check(): MemoryStats {
    const usage = process.memoryUsage();
    const heapUsedMB = usage.heapUsed / 1024 / 1024;
    const heapTotalMB = usage.heapTotal / 1024 / 1024;
    const percentUsed = heapUsedMB / this.maxHeapMB;

    return {
      heapUsedMB,
      heapTotalMB,
      percentUsed,
      warning: percentUsed > this.warningThreshold,
    };
  }

  /**
   * Wait if memory usage is high
   */
  async waitIfHighMemory(): Promise<void> {
    const stats = this.check();

    if (stats.warning) {
      this.logger.warn({
        heapUsedMB: Math.round(stats.heapUsedMB),
        heapTotalMB: Math.round(stats.heapTotalMB),
        percentUsed: Math.round(stats.percentUsed * 100),
        threshold: Math.round(this.warningThreshold * 100),
      }, 'High memory usage detected, triggering GC and pausing');

      // Trigger GC if available
      if (global.gc) {
        global.gc();
      }

      // Wait for GC to complete
      await this.sleep(1000);
    }
  }

  /**
   * Get current memory stats
   */
  getStats(): MemoryStats {
    return this.check();
  }

  /**
   * Log current memory usage
   */
  logStats(): void {
    const stats = this.check();

    this.logger.info({
      heapUsedMB: Math.round(stats.heapUsedMB),
      heapTotalMB: Math.round(stats.heapTotalMB),
      percentUsed: Math.round(stats.percentUsed * 100),
      maxHeapMB: this.maxHeapMB,
    }, 'Memory usage');
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
