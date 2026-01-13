import * as fs from 'node:fs';
import * as path from 'node:path';
import { ABIError } from '../utils/errors.js';

/**
 * Get the cache file path for a given address and chain ID
 */
export function getCacheFilePath(
  address: string,
  chainId: number,
  cacheDir: string
): string {
  const normalizedAddress = address.toLowerCase();
  return path.join(cacheDir, chainId.toString(), `${normalizedAddress}.json`);
}

/**
 * Get cached ABI for a contract address on a specific chain
 * Returns null if cache doesn't exist
 */
export function getCachedABI(
  address: string,
  chainId: number,
  cacheDir: string
): string | null {
  try {
    const cacheFilePath = getCacheFilePath(address, chainId, cacheDir);

    if (!fs.existsSync(cacheFilePath)) {
      return null;
    }

    const cachedContent = fs.readFileSync(cacheFilePath, 'utf-8');
    return cachedContent;
  } catch (error) {
    // If there's an error reading cache, treat it as cache miss
    return null;
  }
}

/**
 * Cache ABI for a contract address on a specific chain
 */
export function cacheABI(
  address: string,
  chainId: number,
  abi: any,
  cacheDir: string
): void {
  try {
    const cacheFilePath = getCacheFilePath(address, chainId, cacheDir);

    // Ensure cache directory exists
    const cacheDirPath = path.dirname(cacheFilePath);
    if (!fs.existsSync(cacheDirPath)) {
      fs.mkdirSync(cacheDirPath, { recursive: true });
    }

    // Write ABI to cache
    const abiContent = typeof abi === 'string' ? abi : JSON.stringify(abi);
    fs.writeFileSync(cacheFilePath, abiContent, 'utf-8');
  } catch (error) {
    // If caching fails, throw an error
    throw new ABIError(
      `Failed to cache ABI: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Read ABI from a manual file path
 */
export function readManualABI(filePath: string): string {
  try {
    if (!fs.existsSync(filePath)) {
      throw new ABIError(`Manual ABI file not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');

    // Validate it's valid JSON
    try {
      JSON.parse(content);
    } catch {
      throw new ABIError(`Invalid JSON in manual ABI file: ${filePath}`);
    }

    return content;
  } catch (error) {
    if (error instanceof ABIError) {
      throw error;
    }
    throw new ABIError(
      `Failed to read manual ABI file: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
