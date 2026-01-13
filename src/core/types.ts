export interface DecodedEvent {
  contractAddress: string;
  blockNumber: number;
  blockTimestamp: number;
  transactionHash: string;
  logIndex: number;
  eventName: string;
  eventData: Record<string, unknown>;
}
