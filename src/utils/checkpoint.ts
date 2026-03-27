import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Logger } from './logger.js';

/**
 * Checkpoint metadata structure
 */
export interface Checkpoint {
  version: string;
  contract: string;
  chainId: number;
  lastBlock: number;
  timestamp: string;
  totalEvents: number;
  status: 'in_progress' | 'completed';
  startBlock: number;
  targetBlock: number;
}

/**
 * Manages checkpoint persistence for resume functionality
 */
export class CheckpointManager {
  private checkpointDir: string;

  constructor(
    private baseDir: string = '.chaintap',
    private logger?: Logger
  ) {
    this.checkpointDir = path.join(baseDir, 'checkpoints');
  }

  /**
   * Ensure checkpoint directory exists
   */
  private async ensureCheckpointDir(): Promise<void> {
    try {
      await fs.mkdir(this.checkpointDir, { recursive: true });
    } catch (error) {
      this.logger?.error({
        error: error instanceof Error ? error.message : String(error),
        dir: this.checkpointDir,
      }, 'Failed to create checkpoint directory');
      throw error;
    }
  }

  /**
   * Get checkpoint file path for a contract
   */
  private getCheckpointPath(chainId: number, contractAddress: string): string {
    const normalized = contractAddress.toLowerCase();
    return path.join(this.checkpointDir, `${chainId}-${normalized}.json`);
  }

  /**
   * Save checkpoint atomically
   */
  async save(checkpoint: Checkpoint): Promise<void> {
    await this.ensureCheckpointDir();

    const checkpointPath = this.getCheckpointPath(checkpoint.chainId, checkpoint.contract);
    const tmpPath = `${checkpointPath}.tmp`;

    try {
      // Write to temp file first
      const data = JSON.stringify(checkpoint, null, 2);
      await fs.writeFile(tmpPath, data, 'utf-8');

      // Atomic rename
      await fs.rename(tmpPath, checkpointPath);

      this.logger?.debug({
        contract: checkpoint.contract,
        chainId: checkpoint.chainId,
        lastBlock: checkpoint.lastBlock,
        totalEvents: checkpoint.totalEvents,
      }, 'Checkpoint saved');
    } catch (error) {
      // Clean up temp file if it exists
      try {
        await fs.unlink(tmpPath);
      } catch {
        // Ignore cleanup errors
      }

      this.logger?.error({
        error: error instanceof Error ? error.message : String(error),
        contract: checkpoint.contract,
        chainId: checkpoint.chainId,
      }, 'Failed to save checkpoint');
      throw error;
    }
  }

  /**
   * Load checkpoint from disk
   */
  async load(chainId: number, contractAddress: string): Promise<Checkpoint | null> {
    const checkpointPath = this.getCheckpointPath(chainId, contractAddress);

    try {
      const data = await fs.readFile(checkpointPath, 'utf-8');
      const checkpoint = JSON.parse(data) as Checkpoint;

      this.logger?.debug({
        contract: contractAddress,
        chainId,
        lastBlock: checkpoint.lastBlock,
        totalEvents: checkpoint.totalEvents,
      }, 'Checkpoint loaded');

      return checkpoint;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, not an error
        this.logger?.debug({
          contract: contractAddress,
          chainId,
        }, 'No checkpoint found');
        return null;
      }

      // Corrupted checkpoint file
      this.logger?.warn({
        error: error instanceof Error ? error.message : String(error),
        contract: contractAddress,
        chainId,
      }, 'Failed to load checkpoint (may be corrupted)');

      return null;
    }
  }

  /**
   * Clear checkpoint after successful completion
   */
  async clear(chainId: number, contractAddress: string): Promise<void> {
    const checkpointPath = this.getCheckpointPath(chainId, contractAddress);

    try {
      await fs.unlink(checkpointPath);

      this.logger?.debug({
        contract: contractAddress,
        chainId,
      }, 'Checkpoint cleared');
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, nothing to clear
        return;
      }

      this.logger?.warn({
        error: error instanceof Error ? error.message : String(error),
        contract: contractAddress,
        chainId,
      }, 'Failed to clear checkpoint');
    }
  }

  /**
   * Check if checkpoint exists
   */
  async exists(chainId: number, contractAddress: string): Promise<boolean> {
    const checkpointPath = this.getCheckpointPath(chainId, contractAddress);

    try {
      await fs.access(checkpointPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all checkpoints
   */
  async list(): Promise<Checkpoint[]> {
    try {
      await this.ensureCheckpointDir();
      const files = await fs.readdir(this.checkpointDir);
      const checkpoints: Checkpoint[] = [];

      for (const file of files) {
        if (file.endsWith('.json') && !file.endsWith('.tmp')) {
          try {
            const filePath = path.join(this.checkpointDir, file);
            const data = await fs.readFile(filePath, 'utf-8');
            const checkpoint = JSON.parse(data) as Checkpoint;
            checkpoints.push(checkpoint);
          } catch (error) {
            this.logger?.warn({
              error: error instanceof Error ? error.message : String(error),
              file,
            }, 'Failed to parse checkpoint file');
          }
        }
      }

      return checkpoints;
    } catch (error) {
      this.logger?.error({
        error: error instanceof Error ? error.message : String(error),
      }, 'Failed to list checkpoints');
      return [];
    }
  }
}
