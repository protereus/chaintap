import { DecodedEvent } from '../core/types.js';

export interface EventFilter {
  contractAddress?: string;
  eventName?: string;
  fromBlock?: number;
  toBlock?: number;
  limit?: number;
  offset?: number;
}

export interface StorageAdapter {
  init(): Promise<void>;
  insertEvents(events: DecodedEvent[]): Promise<number>;
  getLastSyncedBlock(contractAddress: string): Promise<number | null>;
  updateSyncStateAndInsertEvents(
    contractAddress: string,
    chainId: number,
    blockNumber: number,
    events: DecodedEvent[]
  ): Promise<void>;
  queryEvents(filter: EventFilter): Promise<DecodedEvent[]>;
  close(): Promise<void>;
}
