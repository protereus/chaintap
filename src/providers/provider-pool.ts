import { ethers } from 'ethers';

export interface ProviderInfo {
  id: string;
  url: string;
  priority: number;
  provider: ethers.JsonRpcProvider;
}

export interface ProviderHealth {
  id: string;
  url: string;
  priority: number;
  healthy: boolean;
  consecutiveFailures: number;
  lastFailure: number | null;
  lastSuccess: number | null;
  lastError?: string;
}

export interface ProviderPoolOptions {
  failureThreshold?: number;
  cooldownPeriod?: number;
}

interface ProviderEntry {
  id: string;
  url: string;
  priority: number;
  provider: ethers.JsonRpcProvider;
  healthy: boolean;
  consecutiveFailures: number;
  lastFailure: number | null;
  lastSuccess: number | null;
  lastError?: string;
}

/**
 * ProviderPool manages a pool of RPC providers with health tracking and failover
 */
export class ProviderPool {
  private providers: Map<string, ProviderEntry>;
  private providerList: ProviderEntry[];
  private failureThreshold: number;
  private cooldownPeriod: number;
  private roundRobinIndex: number = 0;

  constructor(providerConfigs: Array<{ url: string; priority: number }>, options?: ProviderPoolOptions) {
    if (!providerConfigs || providerConfigs.length === 0) {
      throw new Error('At least one provider configuration is required');
    }

    this.failureThreshold = options?.failureThreshold ?? 3;
    this.cooldownPeriod = options?.cooldownPeriod ?? 30000; // 30 seconds default

    this.providers = new Map();
    this.providerList = [];

    // Initialize providers
    for (const config of providerConfigs) {
      const id = this.generateProviderId(config.url);
      const provider = new ethers.JsonRpcProvider(config.url);

      const entry: ProviderEntry = {
        id,
        url: config.url,
        priority: config.priority,
        provider,
        healthy: true,
        consecutiveFailures: 0,
        lastFailure: null,
        lastSuccess: null,
      };

      this.providers.set(id, entry);
      this.providerList.push(entry);
    }

    // Sort by priority descending
    this.providerList.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get a healthy provider with priority-based selection and load balancing
   * Uses weighted round-robin where higher priority providers get more selections
   */
  async getProvider(): Promise<ProviderInfo> {
    const now = Date.now();
    let bestUnhealthyProvider: ProviderEntry | null = null;

    // Get all healthy providers (already sorted by priority descending)
    const healthyProviders: ProviderEntry[] = [];

    for (const entry of this.providerList) {
      if (entry.healthy) {
        healthyProviders.push(entry);
      }

      // Keep track of best unhealthy provider in case we need to allow recovery
      if (!entry.healthy && entry.lastFailure !== null) {
        if (now - entry.lastFailure >= this.cooldownPeriod) {
          bestUnhealthyProvider = entry;
        }
      }
    }

    // If we have healthy providers, distribute load considering all but biased to higher priority
    if (healthyProviders.length > 0) {
      // Create weighted list for selection: repeat higher priority providers
      const weightedList: ProviderEntry[] = [];
      const basePriority = Math.max(0, healthyProviders[healthyProviders.length - 1].priority);

      for (const provider of healthyProviders) {
        // Weight based on priority difference (higher priority = more weight)
        const weight = Math.max(1, provider.priority - basePriority + 1);
        for (let i = 0; i < weight; i++) {
          weightedList.push(provider);
        }
      }

      // Use round-robin on weighted list for load distribution with priority bias
      const provider = weightedList[this.roundRobinIndex % weightedList.length];
      this.roundRobinIndex++;

      return {
        id: provider.id,
        url: provider.url,
        priority: provider.priority,
        provider: provider.provider,
      };
    }

    // If we found an unhealthy provider past cooldown, give it another chance
    if (bestUnhealthyProvider) {
      return {
        id: bestUnhealthyProvider.id,
        url: bestUnhealthyProvider.url,
        priority: bestUnhealthyProvider.priority,
        provider: bestUnhealthyProvider.provider,
      };
    }

    throw new Error('No healthy providers available');
  }

  /**
   * Report a successful request for a provider
   */
  async reportSuccess(providerId: string): Promise<void> {
    const entry = this.providers.get(providerId);
    if (!entry) {
      throw new Error(`Provider ${providerId} not found`);
    }

    entry.healthy = true;
    entry.consecutiveFailures = 0;
    entry.lastSuccess = Date.now();
    entry.lastError = undefined;
  }

  /**
   * Report a failed request for a provider
   */
  async reportFailure(providerId: string, error: Error): Promise<void> {
    const entry = this.providers.get(providerId);
    if (!entry) {
      throw new Error(`Provider ${providerId} not found`);
    }

    entry.consecutiveFailures++;
    entry.lastFailure = Date.now();
    entry.lastError = error.message;

    // Mark as unhealthy if threshold reached
    if (entry.consecutiveFailures >= this.failureThreshold) {
      entry.healthy = false;
    }
  }

  /**
   * Get health status for all providers
   */
  getHealthStatus(): ProviderHealth[] {
    return this.providerList.map((entry) => ({
      id: entry.id,
      url: entry.url,
      priority: entry.priority,
      healthy: entry.healthy,
      consecutiveFailures: entry.consecutiveFailures,
      lastFailure: entry.lastFailure,
      lastSuccess: entry.lastSuccess,
      ...(entry.lastError && { lastError: entry.lastError }),
    }));
  }

  /**
   * Generate a unique ID for a provider based on URL
   */
  private generateProviderId(url: string): string {
    // Use hash-like ID generation
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      const char = url.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `provider-${Math.abs(hash)}`;
  }
}
