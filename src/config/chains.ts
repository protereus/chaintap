import { Chain } from '../cli/config.js';

/**
 * Chain-specific configuration defaults
 */
export interface ChainDefaults {
  batch_size: number;
  max_block_range?: number;
  confirmations: number;
}

/**
 * Default configurations for each supported chain
 *
 * These defaults are based on:
 * - Chain characteristics (block time, reorg depth)
 * - RPC provider limits (free tier constraints)
 * - Production testing results
 */
export const CHAIN_DEFAULTS: Record<Chain, ChainDefaults> = {
  ethereum: {
    batch_size: 10, // Conservative for free tier RPC providers
    max_block_range: 10, // Alchemy free tier limit
    confirmations: 12, // ~2.5 minutes on mainnet
  },
  polygon: {
    batch_size: 50, // Faster blocks, can batch more
    max_block_range: 100, // Polygon RPC generally more permissive
    confirmations: 128, // Higher due to faster block times and reorg risk
  },
  arbitrum: {
    batch_size: 1000, // L2 with very fast blocks
    max_block_range: 100000, // Arbitrum handles huge ranges efficiently
    confirmations: 20, // Fast finality on L2
  },
  base: {
    batch_size: 100, // L2 with 2-second blocks
    max_block_range: 1000, // Reasonable range for L2
    confirmations: 12, // Optimistic rollup finality
  },
  optimism: {
    batch_size: 100, // Similar to Base (both OP Stack)
    max_block_range: 1000,
    confirmations: 12, // Optimistic rollup finality
  },
  bsc: {
    batch_size: 50, // ~3 second blocks
    max_block_range: 100,
    confirmations: 15, // BSC recommended confirmations
  },
};

/**
 * Apply chain-specific defaults to user configuration
 *
 * User config takes precedence over defaults
 */
export function applyChainDefaults(
  chain: Chain,
  userOptions: Partial<ChainDefaults>
): ChainDefaults {
  const defaults = CHAIN_DEFAULTS[chain];

  return {
    batch_size: userOptions.batch_size ?? defaults.batch_size,
    max_block_range: userOptions.max_block_range ?? defaults.max_block_range,
    confirmations: userOptions.confirmations ?? defaults.confirmations,
  };
}
