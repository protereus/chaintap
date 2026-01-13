import { Interface, Log, Result } from 'ethers';
import { DecodedEvent } from '../core/types.js';

export class EventDecoder {
  constructor(private readonly iface: Interface) {}

  /**
   * Get the underlying ethers Interface for topic hash extraction
   */
  get interface(): Interface {
    return this.iface;
  }

  /**
   * Decodes an event log into a DecodedEvent object
   * @param log The event log to decode
   * @returns DecodedEvent or null if the event signature is unknown
   */
  decode(log: Log): DecodedEvent | null {
    try {
      // Parse the log using ethers Interface
      const parsed = this.iface.parseLog({
        topics: [...log.topics],
        data: log.data,
      });

      if (!parsed) {
        // Unknown event signature - return null silently
        return null;
      }

      // Serialize event data to plain object
      const eventData = this.serializeEventData(parsed.args);

      return {
        contractAddress: log.address,
        blockNumber: log.blockNumber,
        blockTimestamp: 0, // Will be filled by fetcher later
        transactionHash: log.transactionHash,
        logIndex: log.index,
        eventName: parsed.name,
        eventData,
      };
    } catch (error) {
      // Failed to decode event log - return null silently
      return null;
    }
  }

  /**
   * Converts ethers Result object to plain object with proper serialization
   * - BigInt values are converted to strings
   * - Bytes are converted to hex strings
   * - Arrays are handled properly
   * @param args The Result object from ethers
   * @returns Plain object suitable for JSON serialization
   */
  private serializeEventData(args: Result): Record<string, unknown> {
    // Use toObject() to get named properties from Result
    const obj = args.toObject();
    const eventData: Record<string, unknown> = {};

    for (const key of Object.keys(obj)) {
      eventData[key] = this.serializeValue(obj[key]);
    }

    return eventData;
  }

  /**
   * Serializes a single value with proper type conversion
   * @param value The value to serialize
   * @returns Serialized value
   */
  private serializeValue(value: unknown): unknown {
    // Handle BigInt
    if (typeof value === 'bigint') {
      return value.toString();
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map((item) => this.serializeValue(item));
    }

    // Handle Result objects (nested structures)
    if (value && typeof value === 'object' && 'toObject' in value) {
      const result = value as Result;
      return this.serializeEventData(result);
    }

    // Handle other objects
    if (value && typeof value === 'object') {
      // Check if it's a bytes-like object from ethers
      if ('_isIndexed' in value || '_isBigNumber' in value) {
        // This shouldn't happen with proper parsing, but handle it
        return String(value);
      }
    }

    // Return as-is for strings, numbers, booleans, null, undefined
    return value;
  }
}
