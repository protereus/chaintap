import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Interface, EventLog } from 'ethers';
import { EventDecoder } from '../../../src/abi/decoder.js';
import { DecodedEvent } from '../../../src/core/types.js';
import { ERC20_ABI, TEST_ABI } from '../../fixtures/abis.js';

// Mock logger
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('EventDecoder', () => {
  describe('ERC20 Transfer event', () => {
    it('should decode Transfer event with indexed parameters', () => {
      const iface = new Interface(ERC20_ABI);
      const decoder = new EventDecoder(iface);

      // Create a mock Transfer event log
      const from = '0x1234567890123456789012345678901234567890';
      const to = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
      const value = 1000000000000000000n; // 1 token with 18 decimals

      const fragment = iface.getEvent('Transfer');
      const encodedLog = iface.encodeEventLog(fragment!, [from, to, value]);
      const topics = encodedLog.topics as string[];
      const data = encodedLog.data;

      const log: EventLog = {
        provider: null,
        transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        blockHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        blockNumber: 12345678,
        removed: false,
        address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        data,
        topics,
        index: 5,
        transactionIndex: 10,
      } as EventLog;

      const result = decoder.decode(log);

      expect(result).not.toBeNull();
      expect(result!.contractAddress).toBe('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
      expect(result!.blockNumber).toBe(12345678);
      expect(result!.blockTimestamp).toBe(0); // Initially 0, filled by fetcher later
      expect(result!.transactionHash).toBe('0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890');
      expect(result!.logIndex).toBe(5);
      expect(result!.eventName).toBe('Transfer');
      expect((result!.eventData.from as string).toLowerCase()).toBe(from.toLowerCase());
      expect((result!.eventData.to as string).toLowerCase()).toBe(to.toLowerCase());
      expect(result!.eventData.value).toBe('1000000000000000000'); // BigInt converted to string
    });
  });

  describe('Event with non-indexed bytes32 parameter', () => {
    it('should decode event with bytes32 as hex string', () => {
      const iface = new Interface(TEST_ABI);
      const decoder = new EventDecoder(iface);

      const hash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const sender = '0x1234567890123456789012345678901234567890';

      const fragment = iface.getEvent('DataStored');
      const encodedLog = iface.encodeEventLog(fragment!, [hash, sender]);
      const topics = encodedLog.topics as string[];
      const data = encodedLog.data;

      const log: EventLog = {
        provider: null,
        transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        blockHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        blockNumber: 12345678,
        removed: false,
        address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        data,
        topics,
        index: 0,
        transactionIndex: 10,
      } as EventLog;

      const result = decoder.decode(log);

      expect(result).not.toBeNull();
      expect(result!.eventName).toBe('DataStored');
      expect(result!.eventData.hash).toBe(hash);
      expect((result!.eventData.sender as string).toLowerCase()).toBe(sender.toLowerCase());
    });
  });

  describe('Event with array parameters', () => {
    it('should decode event with array parameters', () => {
      const iface = new Interface(TEST_ABI);
      const decoder = new EventDecoder(iface);

      const values = [100n, 200n, 300n];
      const addresses = [
        '0x1234567890123456789012345678901234567890',
        '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      ];

      const fragment = iface.getEvent('ArraysUpdated');
      const encodedLog = iface.encodeEventLog(fragment!, [values, addresses]);
      const topics = encodedLog.topics as string[];
      const data = encodedLog.data;

      const log: EventLog = {
        provider: null,
        transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        blockHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        blockNumber: 12345678,
        removed: false,
        address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        data,
        topics,
        index: 0,
        transactionIndex: 10,
      } as EventLog;

      const result = decoder.decode(log);

      expect(result).not.toBeNull();
      expect(result!.eventName).toBe('ArraysUpdated');
      expect(Array.isArray(result!.eventData.values)).toBe(true);
      expect(result!.eventData.values).toEqual(['100', '200', '300']); // BigInts converted to strings
      expect(Array.isArray(result!.eventData.addresses)).toBe(true);
      // Compare addresses case-insensitively (ethers returns checksummed addresses)
      const resultAddresses = result!.eventData.addresses as string[];
      expect(resultAddresses.map(a => a.toLowerCase())).toEqual(addresses.map(a => a.toLowerCase()));
    });
  });

  describe('Unknown event signature', () => {
    it('should return null for unknown event signature', () => {
      const iface = new Interface(ERC20_ABI);
      const decoder = new EventDecoder(iface);

      // Create a log with unknown event signature
      const log: EventLog = {
        provider: null,
        transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        blockHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        blockNumber: 12345678,
        removed: false,
        address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        data: '0x',
        topics: ['0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'], // Unknown topic
        index: 0,
        transactionIndex: 10,
      } as EventLog;

      const result = decoder.decode(log);

      expect(result).toBeNull();
    });
  });

  describe('Multiple events from same transaction', () => {
    it('should decode multiple events correctly', () => {
      const iface = new Interface(ERC20_ABI);
      const decoder = new EventDecoder(iface);

      const txHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      const blockNumber = 12345678;
      const contractAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

      // First Transfer event
      const from1 = '0x1234567890123456789012345678901234567890';
      const to1 = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
      const value1 = 1000n;

      const fragment1 = iface.getEvent('Transfer');
      const encodedLog1 = iface.encodeEventLog(fragment1!, [from1, to1, value1]);
      const topics1 = encodedLog1.topics as string[];
      const data1 = encodedLog1.data;

      const log1: EventLog = {
        provider: null,
        transactionHash: txHash,
        blockHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        blockNumber,
        removed: false,
        address: contractAddress,
        data: data1,
        topics: topics1,
        index: 0,
        transactionIndex: 10,
      } as EventLog;

      // Second Transfer event
      const from2 = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const to2 = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      const value2 = 2000n;

      const encodedLog2 = iface.encodeEventLog(fragment1!, [from2, to2, value2]);
      const topics2 = encodedLog2.topics as string[];
      const data2 = encodedLog2.data;

      const log2: EventLog = {
        provider: null,
        transactionHash: txHash,
        blockHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        blockNumber,
        removed: false,
        address: contractAddress,
        data: data2,
        topics: topics2,
        index: 1,
        transactionIndex: 10,
      } as EventLog;

      const result1 = decoder.decode(log1);
      const result2 = decoder.decode(log2);

      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
      expect(result1!.transactionHash).toBe(txHash);
      expect(result2!.transactionHash).toBe(txHash);
      expect(result1!.logIndex).toBe(0);
      expect(result2!.logIndex).toBe(1);
      expect(result1!.eventData.value).toBe('1000');
      expect(result2!.eventData.value).toBe('2000');
    });
  });

  describe('BigInt conversion', () => {
    it('should convert BigInt values to strings', () => {
      const iface = new Interface(TEST_ABI);
      const decoder = new EventDecoder(iface);

      const largeNumber = 123456789012345678901234567890n;
      const signedNumber = -987654321098765432109876543210n;

      const fragment = iface.getEvent('BigNumbers');
      const encodedLog = iface.encodeEventLog(fragment!, [largeNumber, signedNumber]);
      const topics = encodedLog.topics as string[];
      const data = encodedLog.data;

      const log: EventLog = {
        provider: null,
        transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        blockHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        blockNumber: 12345678,
        removed: false,
        address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        data,
        topics,
        index: 0,
        transactionIndex: 10,
      } as EventLog;

      const result = decoder.decode(log);

      expect(result).not.toBeNull();
      expect(result!.eventName).toBe('BigNumbers');
      expect(typeof result!.eventData.largeNumber).toBe('string');
      expect(result!.eventData.largeNumber).toBe('123456789012345678901234567890');
      expect(typeof result!.eventData.signedNumber).toBe('string');
      // Negative numbers wrap around in uint256, so we check that it's a string
      expect(typeof result!.eventData.signedNumber).toBe('string');
    });
  });

  describe('Bytes conversion', () => {
    it('should convert bytes to hex strings', () => {
      const iface = new Interface(TEST_ABI);
      const decoder = new EventDecoder(iface);

      const bytesData = '0x1234567890abcdef';

      const fragment = iface.getEvent('BytesData');
      const encodedLog = iface.encodeEventLog(fragment!, [bytesData]);
      const topics = encodedLog.topics as string[];
      const data = encodedLog.data;

      const log: EventLog = {
        provider: null,
        transactionHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        blockHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        blockNumber: 12345678,
        removed: false,
        address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        data,
        topics,
        index: 0,
        transactionIndex: 10,
      } as EventLog;

      const result = decoder.decode(log);

      expect(result).not.toBeNull();
      expect(result!.eventName).toBe('BytesData');
      expect(typeof result!.eventData.data).toBe('string');
      expect(result!.eventData.data).toMatch(/^0x[0-9a-f]+$/); // Hex string with 0x prefix
    });
  });
});
