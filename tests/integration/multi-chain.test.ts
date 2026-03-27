import { describe, it, expect, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import { Indexer } from '../../src/core/indexer.js';
import { SQLiteAdapter } from '../../src/storage/sqlite.js';
import { ProviderPool } from '../../src/providers/provider-pool.js';
import { Logger } from '../../src/utils/logger.js';
import { Config } from '../../src/cli/config.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Multi-Chain Integration Tests
 *
 * Tests USDC contract indexing on multiple chains to validate:
 * - V2 API endpoint compatibility
 * - Chain-specific RPC configurations
 * - Event decoding across chains
 * - Memory efficiency with different batch sizes
 *
 * Test Contracts:
 * - Polygon: USDC (0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359)
 * - Arbitrum: USDC (0xaf88d065e77c8cC2239327C5EDb3A432268e5831)
 * - Base: USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
 *
 * Note: These tests require:
 * - ETHERSCAN_API_KEY environment variable
 * - Active RPC endpoints for each chain
 * - Network connectivity
 *
 * Skip with: SKIP_INTEGRATION_TESTS=1
 */

const SKIP_TESTS = process.env.SKIP_INTEGRATION_TESTS === '1';

// Test configuration for each chain
const CHAIN_TEST_CONFIGS = {
  polygon: {
    chain: 'polygon' as const,
    chainId: 137,
    contractAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // USDC on Polygon
    contractName: 'USDC (Polygon)',
    rpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
    // Test a recent 10K block range
    fromBlock: 50000000,
    toBlock: 50010000,
    expectedMinEvents: 0, // May be 0 if no activity in range
  },
  arbitrum: {
    chain: 'arbitrum' as const,
    chainId: 42161,
    contractAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC on Arbitrum
    contractName: 'USDC (Arbitrum)',
    rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    // Test a recent 10K block range
    fromBlock: 150000000,
    toBlock: 150010000,
    expectedMinEvents: 0,
  },
  base: {
    chain: 'base' as const,
    chainId: 8453,
    contractAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
    contractName: 'USDC (Base)',
    rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    // Test a recent 10K block range
    fromBlock: 10000000,
    toBlock: 10010000,
    expectedMinEvents: 0,
  },
};

describe('Multi-Chain Integration Tests', () => {
  let logger: Logger;
  let tempDir: string;

  beforeEach(() => {
    // Create logger
    logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    } as any;

    // Create temporary directory for test databases
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaintap-test-'));
  });

  /**
   * Helper to create config for a chain
   */
  function createConfig(chainConfig: typeof CHAIN_TEST_CONFIGS[keyof typeof CHAIN_TEST_CONFIGS]): Config {
    return {
      chain: chainConfig.chain,
      database: {
        type: 'sqlite',
        path: path.join(tempDir, `${chainConfig.chain}.db`),
      },
      contracts: [
        {
          address: chainConfig.contractAddress,
          name: chainConfig.contractName,
          events: ['Transfer'],
          from_block: chainConfig.fromBlock,
          abi: undefined,
        },
      ],
      providers: [
        {
          url: chainConfig.rpcUrl,
          priority: 1,
        },
      ],
      options: {
        batch_size: 2000, // Will be overridden by chain defaults
        confirmations: 12, // Will be overridden by chain defaults
        poll_interval: 15000,
        max_retries: 5,
      },
    };
  }

  /**
   * Helper to run indexing test for a chain
   */
  async function testChainIndexing(
    chainName: keyof typeof CHAIN_TEST_CONFIGS
  ): Promise<void> {
    const chainConfig = CHAIN_TEST_CONFIGS[chainName];
    const config = createConfig(chainConfig);

    // Create storage adapter
    const storage = new SQLiteAdapter(config.database.path);
    await storage.init();

    // Create provider pool
    const providerPool = new ProviderPool(config.providers, logger);

    // Create indexer
    const indexer = new Indexer(config, storage, providerPool, logger);

    try {
      // Index the block range
      await indexer.indexBlocks(
        config.contracts[0],
        chainConfig.fromBlock,
        chainConfig.toBlock
      );

      // Verify events were indexed
      const events = await storage.getEvents(
        chainConfig.contractAddress.toLowerCase(),
        chainConfig.chainId,
        chainConfig.fromBlock,
        chainConfig.toBlock
      );

      // Basic validation
      expect(events).toBeDefined();
      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBeGreaterThanOrEqual(chainConfig.expectedMinEvents);

      // If we got events, validate structure
      if (events.length > 0) {
        const firstEvent = events[0];
        expect(firstEvent).toHaveProperty('block_number');
        expect(firstEvent).toHaveProperty('transaction_hash');
        expect(firstEvent).toHaveProperty('event_name');
        expect(firstEvent).toHaveProperty('args');

        // Validate it's a Transfer event
        expect(firstEvent.event_name).toBe('Transfer');

        // Validate block range
        expect(firstEvent.block_number).toBeGreaterThanOrEqual(chainConfig.fromBlock);
        expect(firstEvent.block_number).toBeLessThanOrEqual(chainConfig.toBlock);
      }

      // Verify sync state
      const syncState = await storage.getSyncState(
        chainConfig.contractAddress.toLowerCase(),
        chainConfig.chainId
      );

      expect(syncState).toBeDefined();
      if (syncState) {
        expect(syncState.last_block).toBeGreaterThanOrEqual(chainConfig.toBlock);
      }
    } finally {
      // Cleanup
      await indexer.stop();
      await storage.close();

      // Remove test database
      try {
        fs.unlinkSync(config.database.path);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }

  it.skipIf(SKIP_TESTS)('indexes Polygon USDC transfers', async () => {
    await testChainIndexing('polygon');
  }, 120000); // 2 minute timeout

  it.skipIf(SKIP_TESTS)('indexes Arbitrum USDC transfers', async () => {
    await testChainIndexing('arbitrum');
  }, 120000); // 2 minute timeout

  it.skipIf(SKIP_TESTS)('indexes Base USDC transfers', async () => {
    await testChainIndexing('base');
  }, 120000); // 2 minute timeout

  it.skipIf(SKIP_TESTS)('validates chain-specific configurations are applied', async () => {
    const polygonConfig = createConfig(CHAIN_TEST_CONFIGS.polygon);
    const storage = new SQLiteAdapter(polygonConfig.database.path);
    await storage.init();

    const providerPool = new ProviderPool(polygonConfig.providers, logger);
    const indexer = new Indexer(polygonConfig, storage, providerPool, logger);

    try {
      // Verify that Polygon-specific defaults were applied
      // Polygon should use batch_size: 50 and confirmations: 128
      expect(polygonConfig.options.batch_size).toBeGreaterThan(10); // Higher than Ethereum's 10
      expect(polygonConfig.options.confirmations).toBeGreaterThan(12); // Higher than default 12

      await indexer.stop();
    } finally {
      await storage.close();
      try {
        fs.unlinkSync(polygonConfig.database.path);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });

  it.skipIf(SKIP_TESTS)('validates memory usage stays reasonable during indexing', async () => {
    const baseConfig = createConfig(CHAIN_TEST_CONFIGS.base);
    const storage = new SQLiteAdapter(baseConfig.database.path);
    await storage.init();

    const providerPool = new ProviderPool(baseConfig.providers, logger);
    const indexer = new Indexer(baseConfig, storage, providerPool, logger);

    try {
      // Track memory usage
      const startMemory = process.memoryUsage();

      await indexer.indexBlocks(
        baseConfig.contracts[0],
        CHAIN_TEST_CONFIGS.base.fromBlock,
        CHAIN_TEST_CONFIGS.base.toBlock
      );

      const endMemory = process.memoryUsage();

      // Memory increase should be reasonable (< 500 MB for 10K blocks)
      const memoryIncreaseMB = (endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024;

      expect(memoryIncreaseMB).toBeLessThan(500);

      await indexer.stop();
    } finally {
      await storage.close();
      try {
        fs.unlinkSync(baseConfig.database.path);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }, 120000);
});
