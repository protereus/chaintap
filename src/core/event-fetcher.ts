import { ethers } from 'ethers';
import { EventDecoder } from '../abi/decoder.js';
import { DecodedEvent } from './types.js';
import { Logger } from '../utils/logger.js';
import { retry } from '../utils/retry.js';

export interface EnrichedEvent extends DecodedEvent {
  blockTimestamp: number;
}

export class EventFetcher {
  private blockRangeLimits: Map<string, number> = new Map();
  private blockTimestampCache: Map<number, number> = new Map();

  constructor(
    private provider: ethers.JsonRpcProvider,
    private providerId: string,
    private decoder: EventDecoder,
    private logger: Logger,
    private initialChunkSize: number = 2000
  ) {}

  async fetchEvents(
    contractAddress: string,
    eventNames: string[],
    fromBlock: number,
    toBlock: number
  ): Promise<EnrichedEvent[]> {
    const allLogs: ethers.Log[] = [];

    // Get the current chunk size for this provider (cached or initial)
    let chunkSize = this.blockRangeLimits.get(this.providerId) ?? this.initialChunkSize;

    // Convert event names to topic hashes
    const topics = eventNames.map(name => {
      const event = this.decoder.interface.getEvent(name);
      if (!event) {
        throw new Error(`Event ${name} not found in contract interface`);
      }
      return event.topicHash;
    });

    let currentBlock = fromBlock;

    while (currentBlock <= toBlock) {
      const rangeEnd = Math.min(currentBlock + chunkSize - 1, toBlock);

      this.logger.debug({
        providerId: this.providerId,
        contractAddress,
        fromBlock: currentBlock,
        toBlock: rangeEnd,
        chunkSize,
      }, 'Fetching logs');

      try {
        const logs = await this.provider.getLogs({
          address: contractAddress,
          topics: [topics],
          fromBlock: currentBlock,
          toBlock: rangeEnd,
        });

        allLogs.push(...logs);

        // Move to next chunk
        currentBlock = rangeEnd + 1;

      } catch (error) {
        // Check if it's a block range error before handling
        if (this.isBlockRangeError(error)) {
          // Reduce chunk size and retry this range
          const oldChunkSize = chunkSize;
          chunkSize = Math.max(Math.floor(chunkSize / 2), 100);

          this.logger.warn({
            providerId: this.providerId,
            oldChunkSize,
            newChunkSize: chunkSize,
            fromBlock: currentBlock,
            toBlock: rangeEnd,
            error: error instanceof Error ? error.message : String(error),
          }, 'Block range too large, reducing chunk size');

          // Cache the new chunk size for this provider
          this.blockRangeLimits.set(this.providerId, chunkSize);

          // Don't increment currentBlock - retry with smaller chunk
          continue;
        }

        // Re-throw non-block-range errors
        throw error;
      }
    }

    // Enrich logs with timestamps
    const enrichedEvents = await this.enrichWithTimestamps(allLogs);

    this.logger.info({
      providerId: this.providerId,
      contractAddress,
      fromBlock,
      toBlock,
      eventCount: enrichedEvents.length,
      finalChunkSize: chunkSize,
    }, 'Fetched events');

    return enrichedEvents;
  }

  private async enrichWithTimestamps(logs: ethers.Log[]): Promise<EnrichedEvent[]> {
    if (logs.length === 0) {
      return [];
    }

    // Get unique block numbers that aren't already cached
    const uniqueBlockNumbers = [...new Set(logs.map(log => log.blockNumber))];
    const uncachedBlockNumbers = uniqueBlockNumbers.filter(
      blockNum => !this.blockTimestampCache.has(blockNum)
    );

    // Batch fetch timestamps for uncached blocks
    if (uncachedBlockNumbers.length > 0) {
      this.logger.debug({
        providerId: this.providerId,
        blockCount: uncachedBlockNumbers.length,
      }, 'Fetching block timestamps');

      await Promise.all(
        uncachedBlockNumbers.map(async blockNum => {
          const block = await retry(
            () => this.provider.getBlock(blockNum),
            {
              retries: 3,
              minTimeout: 1000,
              maxTimeout: 10000,
              logger: this.logger,
              operationName: `getBlock(${blockNum})`,
            }
          );

          if (block) {
            this.blockTimestampCache.set(blockNum, block.timestamp);
          }
        })
      );
    }

    // Decode and enrich events
    const enrichedEvents: EnrichedEvent[] = [];

    for (const log of logs) {
      const decodedEvent = this.decoder.decode(log);

      // Skip events that couldn't be decoded (unknown signature)
      if (!decodedEvent) {
        continue;
      }

      const blockTimestamp = this.blockTimestampCache.get(log.blockNumber);

      if (blockTimestamp === undefined) {
        this.logger.warn({
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
        }, 'Block timestamp not found');
        continue;
      }

      enrichedEvents.push({
        contractAddress: decodedEvent.contractAddress,
        blockNumber: decodedEvent.blockNumber,
        transactionHash: decodedEvent.transactionHash,
        logIndex: decodedEvent.logIndex,
        eventName: decodedEvent.eventName,
        eventData: decodedEvent.eventData,
        blockTimestamp,
      });
    }

    return enrichedEvents;
  }

  private isBlockRangeError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const message = error.message.toLowerCase();

    return (
      message.includes('block range') ||
      message.includes('query returned more than') ||
      message.includes('exceeds max')
    );
  }
}
