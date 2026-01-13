import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ethers } from 'ethers';
import { EventFetcher } from '../../../src/core/event-fetcher';
import { EventDecoder } from '../../../src/core/event-decoder';
import { Logger } from '../../../src/utils/logger';

describe('EventFetcher', () => {
  let mockProvider: any;
  let mockDecoder: any;
  let mockLogger: Logger;
  let fetcher: EventFetcher;

  const contractAddress = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984';
  const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const approvalTopic = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';

  beforeEach(() => {
    mockProvider = {
      getLogs: vi.fn(),
      getBlock: vi.fn(),
    };

    mockDecoder = {
      interface: {
        getEvent: vi.fn((name: string) => {
          if (name === 'Transfer') {
            return { topicHash: transferTopic };
          }
          if (name === 'Approval') {
            return { topicHash: approvalTopic };
          }
          return null;
        }),
      },
      decode: vi.fn(),
    };

    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any;

    fetcher = new EventFetcher(
      mockProvider as any,
      'test-provider',
      mockDecoder as any,
      mockLogger
    );
  });

  describe('fetchEvents', () => {
    it('should fetch events in chunks respecting initial block size', async () => {
      const fetcher = new EventFetcher(
        mockProvider as any,
        'test-provider',
        mockDecoder as any,
        mockLogger,
        1000 // initial chunk size
      );

      const mockLogs = [
        {
          address: contractAddress,
          topics: [transferTopic],
          data: '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000',
          blockNumber: 17000100,
          transactionHash: '0xabc',
          logIndex: 0,
        },
        {
          address: contractAddress,
          topics: [transferTopic],
          data: '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000',
          blockNumber: 17001100,
          transactionHash: '0xdef',
          logIndex: 1,
        },
      ];

      let callCount = 0;
      mockProvider.getLogs.mockImplementation(async () => {
        if (callCount === 0) {
          callCount++;
          return [mockLogs[0]]; // First chunk: 17000000-17000999
        } else if (callCount === 1) {
          callCount++;
          return [mockLogs[1]]; // Second chunk: 17001000-17001999
        }
        return []; // Third chunk: 17002000-17002000 (empty)
      });

      mockProvider.getBlock.mockImplementation(async (blockNum: number) => {
        if (blockNum === 17000100) {
          return { number: 17000100, timestamp: 1678900000 };
        } else if (blockNum === 17001100) {
          return { number: 17001100, timestamp: 1678910000 };
        }
        return null;
      });

      mockDecoder.decode.mockImplementation((log: any) => ({
        name: 'Transfer',
        args: { value: ethers.parseEther('1') },
        log,
      }));

      const events = await fetcher.fetchEvents(
        contractAddress,
        ['Transfer'],
        17000000,
        17002000
      );

      expect(mockProvider.getLogs).toHaveBeenCalledTimes(3);
      expect(mockProvider.getLogs).toHaveBeenNthCalledWith(1, {
        address: contractAddress,
        topics: [[transferTopic]],
        fromBlock: 17000000,
        toBlock: 17000999, // fromBlock + chunkSize - 1
      });
      expect(mockProvider.getLogs).toHaveBeenNthCalledWith(2, {
        address: contractAddress,
        topics: [[transferTopic]],
        fromBlock: 17001000,
        toBlock: 17001999,
      });
      expect(mockProvider.getLogs).toHaveBeenNthCalledWith(3, {
        address: contractAddress,
        topics: [[transferTopic]],
        fromBlock: 17002000,
        toBlock: 17002000, // Last block
      });

      expect(events).toHaveLength(2);
      expect(events[0].blockTimestamp).toBe(1678900000);
      expect(events[1].blockTimestamp).toBe(1678910000);
    });

    it('should reduce chunk size on "block range too large" error', async () => {
      const fetcher = new EventFetcher(
        mockProvider as any,
        'test-provider',
        mockDecoder as any,
        mockLogger,
        2000
      );

      const mockLog = {
        address: contractAddress,
        topics: [transferTopic],
        data: '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000',
        blockNumber: 17000100,
        transactionHash: '0xabc',
        logIndex: 0,
      };

      // First call fails with block range error
      let callCount = 0;
      mockProvider.getLogs.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // First call with 2000 blocks fails
          throw new Error('block range too large');
        } else if (callCount === 2) {
          // Retry with 1000 blocks succeeds
          return [mockLog];
        } else {
          // Second chunk empty
          return [];
        }
      });

      mockProvider.getBlock.mockImplementation(async (blockNum: number) => {
        if (blockNum === 17000100) {
          return { number: 17000100, timestamp: 1678900000 };
        }
        return null;
      });

      mockDecoder.decode.mockImplementation((log: any) => ({
        name: 'Transfer',
        args: { value: ethers.parseEther('1') },
        log,
      }));

      const events = await fetcher.fetchEvents(
        contractAddress,
        ['Transfer'],
        17000000,
        17002000
      );

      expect(mockProvider.getLogs).toHaveBeenCalledTimes(4);

      // First call with 2000 blocks
      expect(mockProvider.getLogs).toHaveBeenNthCalledWith(1, {
        address: contractAddress,
        topics: [[transferTopic]],
        fromBlock: 17000000,
        toBlock: 17001999,
      });

      // Retry with 1000 blocks (halved)
      expect(mockProvider.getLogs).toHaveBeenNthCalledWith(2, {
        address: contractAddress,
        topics: [[transferTopic]],
        fromBlock: 17000000,
        toBlock: 17000999,
      });

      // Next chunk with 1000 blocks
      expect(mockProvider.getLogs).toHaveBeenNthCalledWith(3, {
        address: contractAddress,
        topics: [[transferTopic]],
        fromBlock: 17001000,
        toBlock: 17001999,
      });

      // Final chunk for block 17002000
      expect(mockProvider.getLogs).toHaveBeenNthCalledWith(4, {
        address: contractAddress,
        topics: [[transferTopic]],
        fromBlock: 17002000,
        toBlock: 17002000,
      });

      expect(events).toHaveLength(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('Block range too large')
      );
    });

    it('should never reduce chunk size below 100 blocks minimum', async () => {
      const fetcher = new EventFetcher(
        mockProvider as any,
        'test-provider',
        mockDecoder as any,
        mockLogger,
        200
      );

      // Simulate multiple block range errors to try to reduce below 100
      let callCount = 0;
      mockProvider.getLogs.mockImplementation(async () => {
        callCount++;
        if (callCount <= 3) {
          throw new Error('block range too large');
        } else {
          throw new Error('Some other error');
        }
      });

      await expect(
        fetcher.fetchEvents(contractAddress, ['Transfer'], 17000000, 17000500)
      ).rejects.toThrow('Some other error');

      // Should try with 200, then 100, then 100, then 100
      expect(mockProvider.getLogs).toHaveBeenCalledTimes(4);
      expect(mockProvider.getLogs).toHaveBeenNthCalledWith(1, {
        address: contractAddress,
        topics: [[transferTopic]],
        fromBlock: 17000000,
        toBlock: 17000199,
      });
      expect(mockProvider.getLogs).toHaveBeenNthCalledWith(2, {
        address: contractAddress,
        topics: [[transferTopic]],
        fromBlock: 17000000,
        toBlock: 17000099, // Halved to 100
      });
      expect(mockProvider.getLogs).toHaveBeenNthCalledWith(3, {
        address: contractAddress,
        topics: [[transferTopic]],
        fromBlock: 17000000,
        toBlock: 17000099, // Still 100 (minimum)
      });
    });

    it('should enrich events with block timestamp using batch getBlock calls', async () => {
      const mockLogs = [
        {
          address: contractAddress,
          topics: [transferTopic],
          data: '0x00',
          blockNumber: 17000100,
          transactionHash: '0xabc',
          logIndex: 0,
        },
        {
          address: contractAddress,
          topics: [transferTopic],
          data: '0x00',
          blockNumber: 17000100, // Same block
          transactionHash: '0xdef',
          logIndex: 1,
        },
        {
          address: contractAddress,
          topics: [transferTopic],
          data: '0x00',
          blockNumber: 17000200,
          transactionHash: '0xghi',
          logIndex: 0,
        },
      ];

      mockProvider.getLogs.mockImplementation(async () => mockLogs);

      // Should only call getBlock for unique block numbers
      mockProvider.getBlock.mockImplementation(async (blockNum: number) => {
        if (blockNum === 17000100) {
          return { number: 17000100, timestamp: 1678900000 };
        } else if (blockNum === 17000200) {
          return { number: 17000200, timestamp: 1678910000 };
        }
        return null;
      });

      mockDecoder.decode.mockImplementation((log: any) => ({
        name: 'Transfer',
        args: {},
        log,
      }));

      const events = await fetcher.fetchEvents(
        contractAddress,
        ['Transfer'],
        17000000,
        17001000
      );

      expect(mockProvider.getBlock).toHaveBeenCalledTimes(2);
      expect(mockProvider.getBlock).toHaveBeenCalledWith(17000100);
      expect(mockProvider.getBlock).toHaveBeenCalledWith(17000200);

      expect(events).toHaveLength(3);
      expect(events[0].blockTimestamp).toBe(1678900000);
      expect(events[1].blockTimestamp).toBe(1678900000);
      expect(events[2].blockTimestamp).toBe(1678910000);
    });

    it('should handle empty event result (no events in range)', async () => {
      mockProvider.getLogs.mockImplementation(async () => []);

      const events = await fetcher.fetchEvents(
        contractAddress,
        ['Transfer'],
        17000000,
        17001000
      );

      expect(events).toHaveLength(0);
      expect(mockProvider.getBlock).not.toHaveBeenCalled();
    });

    it('should fetch multiple event types using topic array', async () => {
      const mockLogs = [
        {
          address: contractAddress,
          topics: [transferTopic],
          data: '0x00',
          blockNumber: 17000100,
          transactionHash: '0xabc',
          logIndex: 0,
        },
        {
          address: contractAddress,
          topics: [approvalTopic],
          data: '0x00',
          blockNumber: 17000200,
          transactionHash: '0xdef',
          logIndex: 0,
        },
      ];

      mockProvider.getLogs.mockImplementation(async () => mockLogs);
      mockProvider.getBlock.mockImplementation(async (blockNum: number) => {
        if (blockNum === 17000100) {
          return { number: 17000100, timestamp: 1678900000 };
        } else if (blockNum === 17000200) {
          return { number: 17000200, timestamp: 1678910000 };
        }
        return null;
      });

      mockDecoder.decode.mockImplementation((log: any) => ({
        name: log.topics[0] === transferTopic ? 'Transfer' : 'Approval',
        args: {},
        log,
      }));

      const events = await fetcher.fetchEvents(
        contractAddress,
        ['Transfer', 'Approval'],
        17000000,
        17001000
      );

      expect(mockProvider.getLogs).toHaveBeenCalledWith({
        address: contractAddress,
        topics: [[transferTopic, approvalTopic]],
        fromBlock: 17000000,
        toBlock: 17001000, // Range fits within default chunk size
      });

      expect(events).toHaveLength(2);
      expect(events[0].name).toBe('Transfer');
      expect(events[1].name).toBe('Approval');
    });
  });

  describe('isBlockRangeError', () => {
    it('should detect "block range" error message', () => {
      const error = new Error('block range too large');
      expect((fetcher as any).isBlockRangeError(error)).toBe(true);
    });

    it('should detect "query returned more than" error message', () => {
      const error = new Error('query returned more than 10000 results');
      expect((fetcher as any).isBlockRangeError(error)).toBe(true);
    });

    it('should detect "exceeds max" error message', () => {
      const error = new Error('range exceeds max limit');
      expect((fetcher as any).isBlockRangeError(error)).toBe(true);
    });

    it('should not detect other errors as block range errors', () => {
      const error = new Error('network connection failed');
      expect((fetcher as any).isBlockRangeError(error)).toBe(false);
    });

    it('should handle error without message', () => {
      const error = new Error();
      expect((fetcher as any).isBlockRangeError(error)).toBe(false);
    });
  });

  describe('caching behavior', () => {
    it('should cache working block range limits per provider', async () => {
      const fetcher = new EventFetcher(
        mockProvider as any,
        'test-provider',
        mockDecoder as any,
        mockLogger,
        2000
      );

      // First range: reduce from 2000 to 1000
      let callCount = 0;
      mockProvider.getLogs.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('block range too large');
        }
        return [];
      });

      await fetcher.fetchEvents(contractAddress, ['Transfer'], 17000000, 17001000);

      mockProvider.getLogs.mockClear();
      callCount = 0;

      // Second range: should start with cached 1000 block limit
      mockProvider.getLogs.mockImplementation(async () => []);

      await fetcher.fetchEvents(contractAddress, ['Transfer'], 18000000, 18001000);

      // Should use the cached chunk size of 1000
      // Range 18000000-18001000 is 1001 blocks, so needs 2 chunks with size 1000
      expect(mockProvider.getLogs).toHaveBeenCalledTimes(2);
      expect(mockProvider.getLogs).toHaveBeenNthCalledWith(1, {
        address: contractAddress,
        topics: [[transferTopic]],
        fromBlock: 18000000,
        toBlock: 18000999, // First chunk with cached 1000 block limit
      });
      expect(mockProvider.getLogs).toHaveBeenNthCalledWith(2, {
        address: contractAddress,
        topics: [[transferTopic]],
        fromBlock: 18001000,
        toBlock: 18001000, // Second chunk (last block)
      });
    });
  });

  describe('timestamp caching', () => {
    it('should cache block timestamps across multiple chunks', async () => {
      const fetcher = new EventFetcher(
        mockProvider as any,
        'test-provider',
        mockDecoder as any,
        mockLogger,
        500
      );

      // First chunk has block 17000100
      const logs1 = [
        {
          address: contractAddress,
          topics: [transferTopic],
          data: '0x00',
          blockNumber: 17000100,
          transactionHash: '0xabc',
          logIndex: 0,
        },
      ];

      // Second chunk also has block 17000100 (same block)
      const logs2 = [
        {
          address: contractAddress,
          topics: [transferTopic],
          data: '0x00',
          blockNumber: 17000100,
          transactionHash: '0xdef',
          logIndex: 0,
        },
      ];

      let callCount = 0;
      mockProvider.getLogs.mockImplementation(async () => {
        if (callCount === 0) {
          callCount++;
          return logs1;
        } else if (callCount === 1) {
          callCount++;
          return logs2;
        }
        return [];
      });

      // Should only be called once for block 17000100
      mockProvider.getBlock.mockImplementation(async (blockNum: number) => {
        if (blockNum === 17000100) {
          return { number: 17000100, timestamp: 1678900000 };
        }
        return null;
      });

      mockDecoder.decode.mockImplementation((log: any) => ({
        name: 'Transfer',
        args: {},
        log,
      }));

      const events = await fetcher.fetchEvents(
        contractAddress,
        ['Transfer'],
        17000000,
        17001000
      );

      expect(mockProvider.getBlock).toHaveBeenCalledTimes(1);
      expect(events).toHaveLength(2);
      expect(events[0].blockTimestamp).toBe(1678900000);
      expect(events[1].blockTimestamp).toBe(1678900000);
    });
  });
});
