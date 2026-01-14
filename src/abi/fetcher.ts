import { Interface } from 'ethers';
import { AbortError } from 'p-retry';
import { ABIError } from '../utils/errors.js';
import { retry } from '../utils/retry.js';
import { getCachedABI, cacheABI, readManualABI } from './cache.js';

/**
 * Map of chain IDs to their explorer API base URLs
 */
const EXPLORER_APIS: Record<number, string> = {
  1: 'https://api.etherscan.io/v2/api',
  10: 'https://api-optimistic.etherscan.io/api',
  56: 'https://api.bscscan.com/api',
  137: 'https://api.polygonscan.com/api',
  8453: 'https://api.basescan.org/api',
  42161: 'https://api.arbiscan.io/api',
};

/**
 * Timeout for fetch requests in milliseconds
 */
const FETCH_TIMEOUT = 30000;

/**
 * Response from Etherscan-like APIs
 */
interface ExplorerAPIResponse {
  status: string;
  message: string;
  result: string;
}

/**
 * ABIFetcher handles fetching and caching contract ABIs
 */
export class ABIFetcher {
  private cacheDir: string;
  private apiKey?: string;

  constructor(cacheDir: string, apiKey?: string) {
    this.cacheDir = cacheDir;
    this.apiKey = apiKey;
  }

  /**
   * Get ABI for a contract address on a specific chain
   * Supports cache, manual path, and fetching from explorer APIs
   */
  async getABI(
    address: string,
    chainId: number,
    manualPath?: string
  ): Promise<Interface> {
    const normalizedAddress = address.toLowerCase();

    // 1. Check if manual path is provided
    if (manualPath) {
      const abiContent = readManualABI(manualPath);
      const abi = JSON.parse(abiContent);

      // Cache the manually loaded ABI
      cacheABI(normalizedAddress, chainId, abi, this.cacheDir);

      return new Interface(abi);
    }

    // 2. Check cache
    const cachedABI = getCachedABI(normalizedAddress, chainId, this.cacheDir);
    if (cachedABI) {
      const abi = JSON.parse(cachedABI);
      return new Interface(abi);
    }

    // 3. Fetch from explorer API
    const abi = await this.fetchFromExplorer(normalizedAddress, chainId);

    // Cache the fetched ABI
    cacheABI(normalizedAddress, chainId, abi, this.cacheDir);

    return new Interface(abi);
  }

  /**
   * Fetch ABI from explorer API
   */
  private async fetchFromExplorer(
    address: string,
    chainId: number
  ): Promise<any[]> {
    const explorerAPI = EXPLORER_APIS[chainId];

    if (!explorerAPI) {
      throw new ABIError(`Unsupported chain ID: ${chainId}`);
    }

    // Build API URL
    const url = new URL(explorerAPI);
    url.searchParams.set('module', 'contract');
    url.searchParams.set('action', 'getabi');
    url.searchParams.set('address', address);
    url.searchParams.set('chainid', String(chainId));

    if (this.apiKey) {
      url.searchParams.set('apikey', this.apiKey);
    }

    // Fetch with retry logic (only retry on network errors, not HTTP errors)
    const response = await retry(
      async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

        try {
          const response = await fetch(url.toString(), {
            signal: controller.signal,
            headers: {
              'User-Agent': 'ChainTap/1.0',
            },
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            // HTTP errors should not be retried - throw p-retry's AbortError
            throw new AbortError(
              `HTTP error ${response.status}: ${response.statusText}`
            );
          }

          return response;
        } catch (error) {
          clearTimeout(timeoutId);
          if (error instanceof AbortError) {
            throw error;
          }
          // Network errors can be retried
          throw error;
        }
      },
      {
        retries: 5,
        operationName: 'fetch ABI from explorer',
        minTimeout: 1000,
        maxTimeout: 30000,
      }
    );

    // Parse JSON response
    const data = (await response.json()) as ExplorerAPIResponse;

    // Check if request was successful
    if (data.status !== '1') {
      // Check for common error messages indicating unverified contract
      const errorMessage = data.result.toLowerCase();
      if (
        errorMessage.includes('not verified') ||
        errorMessage.includes('source code not verified')
      ) {
        // Don't retry for verification errors - throw immediately
        const error = new ABIError(
          'Contract ABI not verified on Etherscan. Provide manual ABI path in config.'
        );
        // Mark as non-retryable by adding a special property
        (error as Error & { skipRetry?: boolean }).skipRetry = true;
        throw error;
      }

      throw new ABIError(`Explorer API error: ${data.result}`);
    }

    // Parse ABI from result
    try {
      const abi = JSON.parse(data.result);
      return abi;
    } catch (error) {
      throw new ABIError(
        `Failed to parse ABI: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
