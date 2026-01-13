import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ABIFetcher } from '../../../src/abi/fetcher.js';
import { ABIError } from '../../../src/utils/errors.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Interface } from 'ethers';

describe('ABIFetcher', () => {
  const testCacheDir = '/tmp/chaintap-test-cache';
  const testApiKey = 'test-api-key';
  const testAddress = '0x1234567890123456789012345678901234567890';
  const testChainId = 1;

  // Sample ABI for testing
  const sampleABI = [
    {
      inputs: [],
      name: 'totalSupply',
      outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
      stateMutability: 'view',
      type: 'function',
    },
  ];

  beforeEach(() => {
    // Clean up test cache directory
    if (fs.existsSync(testCacheDir)) {
      fs.rmSync(testCacheDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testCacheDir, { recursive: true });

    // Reset all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up test cache directory
    if (fs.existsSync(testCacheDir)) {
      fs.rmSync(testCacheDir, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('should create an instance with cache directory', () => {
      const fetcher = new ABIFetcher(testCacheDir);
      expect(fetcher).toBeInstanceOf(ABIFetcher);
    });

    it('should create an instance with cache directory and API key', () => {
      const fetcher = new ABIFetcher(testCacheDir, testApiKey);
      expect(fetcher).toBeInstanceOf(ABIFetcher);
    });
  });

  describe('getABI - Etherscan API', () => {
    it('should fetch ABI from Etherscan API successfully', async () => {
      const fetcher = new ABIFetcher(testCacheDir, testApiKey);

      // Mock fetch
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: '1',
          message: 'OK',
          result: JSON.stringify(sampleABI),
        }),
      });
      global.fetch = mockFetch;

      const result = await fetcher.getABI(testAddress, testChainId);

      expect(result).toBeInstanceOf(Interface);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('api.etherscan.io'),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(testAddress),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(testApiKey),
        expect.any(Object)
      );
    });

    it('should use correct explorer API for Polygon (chainId 137)', async () => {
      const fetcher = new ABIFetcher(testCacheDir, testApiKey);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: '1',
          message: 'OK',
          result: JSON.stringify(sampleABI),
        }),
      });
      global.fetch = mockFetch;

      await fetcher.getABI(testAddress, 137);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('api.polygonscan.com'),
        expect.any(Object)
      );
    });

    it('should use correct explorer API for Arbitrum (chainId 42161)', async () => {
      const fetcher = new ABIFetcher(testCacheDir, testApiKey);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: '1',
          message: 'OK',
          result: JSON.stringify(sampleABI),
        }),
      });
      global.fetch = mockFetch;

      await fetcher.getABI(testAddress, 42161);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('api.arbiscan.io'),
        expect.any(Object)
      );
    });

    it('should use correct explorer API for Optimism (chainId 10)', async () => {
      const fetcher = new ABIFetcher(testCacheDir, testApiKey);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: '1',
          message: 'OK',
          result: JSON.stringify(sampleABI),
        }),
      });
      global.fetch = mockFetch;

      await fetcher.getABI(testAddress, 10);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('api-optimistic.etherscan.io'),
        expect.any(Object)
      );
    });

    it('should use correct explorer API for Base (chainId 8453)', async () => {
      const fetcher = new ABIFetcher(testCacheDir, testApiKey);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: '1',
          message: 'OK',
          result: JSON.stringify(sampleABI),
        }),
      });
      global.fetch = mockFetch;

      await fetcher.getABI(testAddress, 8453);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('api.basescan.org'),
        expect.any(Object)
      );
    });

    it('should use correct explorer API for BSC (chainId 56)', async () => {
      const fetcher = new ABIFetcher(testCacheDir, testApiKey);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: '1',
          message: 'OK',
          result: JSON.stringify(sampleABI),
        }),
      });
      global.fetch = mockFetch;

      await fetcher.getABI(testAddress, 56);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('api.bscscan.com'),
        expect.any(Object)
      );
    });

    it('should throw ABIError for unverified contract', async () => {
      const fetcher = new ABIFetcher(testCacheDir, testApiKey);

      // Mock fetch returning contract not verified
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: '0',
          message: 'NOTOK',
          result: 'Contract source code not verified',
        }),
      });
      global.fetch = mockFetch;

      await expect(fetcher.getABI(testAddress, testChainId)).rejects.toThrow(
        ABIError
      );
      await expect(fetcher.getABI(testAddress, testChainId)).rejects.toThrow(
        'Contract ABI not verified on Etherscan. Provide manual ABI path in config.'
      );
    });

    it('should throw ABIError when API returns error status', async () => {
      const fetcher = new ABIFetcher(testCacheDir, testApiKey);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: '0',
          message: 'NOTOK',
          result: 'Error! Invalid address format',
        }),
      });
      global.fetch = mockFetch;

      await expect(fetcher.getABI(testAddress, testChainId)).rejects.toThrow(
        ABIError
      );
    });

    it('should throw ABIError for unsupported chain', async () => {
      const fetcher = new ABIFetcher(testCacheDir, testApiKey);

      await expect(fetcher.getABI(testAddress, 999999)).rejects.toThrow(
        ABIError
      );
      await expect(fetcher.getABI(testAddress, 999999)).rejects.toThrow(
        'Unsupported chain ID: 999999'
      );
    });
  });

  describe('getABI - Caching', () => {
    it('should cache ABI after fetching from API', async () => {
      const fetcher = new ABIFetcher(testCacheDir, testApiKey);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: '1',
          message: 'OK',
          result: JSON.stringify(sampleABI),
        }),
      });
      global.fetch = mockFetch;

      // First call - should hit API
      await fetcher.getABI(testAddress, testChainId);

      // Check cache file exists
      const cacheFilePath = path.join(
        testCacheDir,
        testChainId.toString(),
        `${testAddress}.json`
      );
      expect(fs.existsSync(cacheFilePath)).toBe(true);

      // Verify cache content
      const cachedContent = JSON.parse(fs.readFileSync(cacheFilePath, 'utf-8'));
      expect(cachedContent).toEqual(sampleABI);
    });

    it('should read from cache on second call without hitting API', async () => {
      const fetcher = new ABIFetcher(testCacheDir, testApiKey);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: '1',
          message: 'OK',
          result: JSON.stringify(sampleABI),
        }),
      });
      global.fetch = mockFetch;

      // First call - should hit API
      const result1 = await fetcher.getABI(testAddress, testChainId);

      // Second call - should use cache
      const result2 = await fetcher.getABI(testAddress, testChainId);

      // API should only be called once
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Both results should be Interface instances
      expect(result1).toBeInstanceOf(Interface);
      expect(result2).toBeInstanceOf(Interface);

      // Results should have the same format
      expect(result1.format()).toEqual(result2.format());
    });

    it('should use cache across different ABIFetcher instances', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: '1',
          message: 'OK',
          result: JSON.stringify(sampleABI),
        }),
      });
      global.fetch = mockFetch;

      // First fetcher instance
      const fetcher1 = new ABIFetcher(testCacheDir, testApiKey);
      await fetcher1.getABI(testAddress, testChainId);

      // Second fetcher instance
      const fetcher2 = new ABIFetcher(testCacheDir, testApiKey);
      const result = await fetcher2.getABI(testAddress, testChainId);

      // API should only be called once
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result).toBeInstanceOf(Interface);
    });
  });

  describe('getABI - Manual ABI Path', () => {
    it('should load ABI from manual file path', async () => {
      const manualABIPath = path.join(testCacheDir, 'manual-abi.json');
      fs.writeFileSync(manualABIPath, JSON.stringify(sampleABI));

      const fetcher = new ABIFetcher(testCacheDir, testApiKey);
      const mockFetch = vi.fn();
      global.fetch = mockFetch;

      const result = await fetcher.getABI(
        testAddress,
        testChainId,
        manualABIPath
      );

      // Should not call API when manual path provided
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toBeInstanceOf(Interface);
    });

    it('should throw ABIError when manual file does not exist', async () => {
      const manualABIPath = path.join(testCacheDir, 'nonexistent-abi.json');

      const fetcher = new ABIFetcher(testCacheDir, testApiKey);

      await expect(
        fetcher.getABI(testAddress, testChainId, manualABIPath)
      ).rejects.toThrow(ABIError);
      await expect(
        fetcher.getABI(testAddress, testChainId, manualABIPath)
      ).rejects.toThrow('Manual ABI file not found');
    });

    it('should throw ABIError when manual file has invalid JSON', async () => {
      const manualABIPath = path.join(testCacheDir, 'invalid-abi.json');
      fs.writeFileSync(manualABIPath, 'invalid json {{{');

      const fetcher = new ABIFetcher(testCacheDir, testApiKey);

      await expect(
        fetcher.getABI(testAddress, testChainId, manualABIPath)
      ).rejects.toThrow(ABIError);
      await expect(
        fetcher.getABI(testAddress, testChainId, manualABIPath)
      ).rejects.toThrow('Invalid JSON in manual ABI file');
    });

    it('should cache ABI loaded from manual path', async () => {
      const manualABIPath = path.join(testCacheDir, 'manual-abi.json');
      fs.writeFileSync(manualABIPath, JSON.stringify(sampleABI));

      const fetcher = new ABIFetcher(testCacheDir, testApiKey);
      await fetcher.getABI(testAddress, testChainId, manualABIPath);

      // Check cache file exists
      const cacheFilePath = path.join(
        testCacheDir,
        testChainId.toString(),
        `${testAddress}.json`
      );
      expect(fs.existsSync(cacheFilePath)).toBe(true);
    });
  });

  describe('getABI - Retry Logic', () => {
    it('should retry on network timeout', async () => {
      const fetcher = new ABIFetcher(testCacheDir, testApiKey);

      let attemptCount = 0;
      const mockFetch = vi.fn().mockImplementation(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Network timeout');
        }
        return {
          ok: true,
          json: async () => ({
            status: '1',
            message: 'OK',
            result: JSON.stringify(sampleABI),
          }),
        };
      });
      global.fetch = mockFetch;

      const result = await fetcher.getABI(testAddress, testChainId);

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result).toBeInstanceOf(Interface);
    });

    it(
      'should throw error after max retries exceeded',
      async () => {
        const fetcher = new ABIFetcher(testCacheDir, testApiKey);

        const mockFetch = vi
          .fn()
          .mockRejectedValue(new Error('Network timeout'));
        global.fetch = mockFetch;

        await expect(
          fetcher.getABI(testAddress, testChainId)
        ).rejects.toThrow();
        expect(mockFetch).toHaveBeenCalledTimes(6); // Initial attempt + 5 retries (default from retry.ts)
      },
      { timeout: 60000 }
    ); // Increase timeout for retry logic

    it('should not retry on unverified contract error', async () => {
      const fetcher = new ABIFetcher(testCacheDir, testApiKey);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: '0',
          message: 'NOTOK',
          result: 'Contract source code not verified',
        }),
      });
      global.fetch = mockFetch;

      await expect(fetcher.getABI(testAddress, testChainId)).rejects.toThrow(
        ABIError
      );
      // Should only call once (no retries for verification errors)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('getABI - HTTP Errors', () => {
    it('should handle HTTP 404 error', async () => {
      const fetcher = new ABIFetcher(testCacheDir, testApiKey);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({}),
      });
      global.fetch = mockFetch;

      await expect(fetcher.getABI(testAddress, testChainId)).rejects.toThrow();
      // Should not retry on HTTP errors
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle HTTP 500 error', async () => {
      const fetcher = new ABIFetcher(testCacheDir, testApiKey);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({}),
      });
      global.fetch = mockFetch;

      await expect(fetcher.getABI(testAddress, testChainId)).rejects.toThrow();
      // Should not retry on HTTP errors
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Edge Cases', () => {
    it('should normalize address to lowercase', async () => {
      const fetcher = new ABIFetcher(testCacheDir, testApiKey);
      const uppercaseAddress = '0xABCDEF1234567890ABCDEF1234567890ABCDEF12';

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: '1',
          message: 'OK',
          result: JSON.stringify(sampleABI),
        }),
      });
      global.fetch = mockFetch;

      await fetcher.getABI(uppercaseAddress, testChainId);

      // Check that cache uses lowercase address
      const cacheFilePath = path.join(
        testCacheDir,
        testChainId.toString(),
        `${uppercaseAddress.toLowerCase()}.json`
      );
      expect(fs.existsSync(cacheFilePath)).toBe(true);
    });

    it('should handle empty ABI array', async () => {
      const fetcher = new ABIFetcher(testCacheDir, testApiKey);
      const emptyABI: never[] = [];

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: '1',
          message: 'OK',
          result: JSON.stringify(emptyABI),
        }),
      });
      global.fetch = mockFetch;

      const result = await fetcher.getABI(testAddress, testChainId);

      expect(result).toBeInstanceOf(Interface);
    });
  });
});
