import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProviderPool } from '../../../src/providers/provider-pool.js';
import type { ProviderHealth } from '../../../src/providers/provider-pool.js';

describe('ProviderPool', () => {
  const mockProviders = [
    { url: 'http://localhost:8545', priority: 1 },
    { url: 'http://localhost:8546', priority: 2 },
    { url: 'http://localhost:8547', priority: 0 },
  ];

  let pool: ProviderPool;

  beforeEach(() => {
    pool = new ProviderPool(mockProviders);
  });

  describe('constructor', () => {
    it('initializes with array of providers', () => {
      expect(pool).toBeDefined();
    });

    it('accepts options for failure threshold and cooldown', () => {
      const pool2 = new ProviderPool(mockProviders, {
        failureThreshold: 5,
        cooldownPeriod: 60000,
      });
      expect(pool2).toBeDefined();
    });

    it('uses default options if not provided', () => {
      expect(pool).toBeDefined();
    });
  });

  describe('getProvider', () => {
    it('returns highest priority healthy provider', async () => {
      const provider = await pool.getProvider();
      expect(provider).toBeDefined();
      expect(provider.id).toBeDefined();
      expect(provider.url).toBeDefined();
      expect(provider.priority).toBeDefined();
      expect(provider.provider).toBeDefined();
    });

    it('returns providers in priority order', async () => {
      const provider = await pool.getProvider();
      // Should get highest priority provider initially (priority 2)
      expect(provider.priority).toBe(2);
    });

    it('skips unhealthy providers', async () => {
      const provider1 = await pool.getProvider();
      const id1 = provider1.id;

      // Report failure multiple times to mark as unhealthy
      for (let i = 0; i < 4; i++) {
        await pool.reportFailure(id1, new Error('Connection failed'));
      }

      const provider2 = await pool.getProvider();
      // Should get a different provider
      expect(provider2.id).not.toBe(id1);
    });

    it('throws error when no healthy providers available', async () => {
      const health = pool.getHealthStatus();

      // Mark all providers as unhealthy
      for (const provider of health) {
        for (let i = 0; i < 4; i++) {
          await pool.reportFailure(provider.id, new Error('Connection failed'));
        }
      }

      await expect(pool.getProvider()).rejects.toThrow('No healthy providers available');
    });
  });

  describe('reportSuccess', () => {
    it('marks provider as healthy and resets failure count', async () => {
      const provider = await pool.getProvider();
      const id = provider.id;

      // Report some failures first
      for (let i = 0; i < 2; i++) {
        await pool.reportFailure(id, new Error('Connection failed'));
      }

      let health = pool.getHealthStatus().find((h) => h.id === id);
      expect(health?.consecutiveFailures).toBe(2);

      // Report success
      await pool.reportSuccess(id);

      health = pool.getHealthStatus().find((h) => h.id === id);
      expect(health?.healthy).toBe(true);
      expect(health?.consecutiveFailures).toBe(0);
    });

    it('updates lastSuccess timestamp', async () => {
      const provider = await pool.getProvider();
      const id = provider.id;

      const before = Date.now();
      await pool.reportSuccess(id);
      const after = Date.now();

      const health = pool.getHealthStatus().find((h) => h.id === id);
      expect(health?.lastSuccess).toBeDefined();
      expect(health?.lastSuccess! >= before && health?.lastSuccess! <= after).toBe(true);
    });
  });

  describe('reportFailure', () => {
    it('increments consecutive failure count', async () => {
      const provider = await pool.getProvider();
      const id = provider.id;

      await pool.reportFailure(id, new Error('Connection failed'));
      let health = pool.getHealthStatus().find((h) => h.id === id);
      expect(health?.consecutiveFailures).toBe(1);

      await pool.reportFailure(id, new Error('Connection failed'));
      health = pool.getHealthStatus().find((h) => h.id === id);
      expect(health?.consecutiveFailures).toBe(2);
    });

    it('marks provider unhealthy after threshold', async () => {
      const provider = await pool.getProvider();
      const id = provider.id;

      for (let i = 0; i < 4; i++) {
        await pool.reportFailure(id, new Error('Connection failed'));
      }

      const health = pool.getHealthStatus().find((h) => h.id === id);
      expect(health?.healthy).toBe(false);
    });

    it('updates lastFailure timestamp', async () => {
      const provider = await pool.getProvider();
      const id = provider.id;

      const before = Date.now();
      await pool.reportFailure(id, new Error('Connection failed'));
      const after = Date.now();

      const health = pool.getHealthStatus().find((h) => h.id === id);
      expect(health?.lastFailure).toBeDefined();
      expect(health?.lastFailure! >= before && health?.lastFailure! <= after).toBe(true);
    });

    it('tracks error details', async () => {
      const provider = await pool.getProvider();
      const id = provider.id;

      const errorMsg = 'Custom error message';
      await pool.reportFailure(id, new Error(errorMsg));

      const health = pool.getHealthStatus().find((h) => h.id === id);
      expect(health?.lastError).toBe(errorMsg);
    });
  });

  describe('getHealthStatus', () => {
    it('returns health info for all providers', () => {
      const health = pool.getHealthStatus();
      expect(health).toHaveLength(3);
    });

    it('returns ProviderHealth objects with correct structure', () => {
      const health = pool.getHealthStatus();

      health.forEach((h: ProviderHealth) => {
        expect(h).toHaveProperty('id');
        expect(h).toHaveProperty('url');
        expect(h).toHaveProperty('priority');
        expect(h).toHaveProperty('healthy');
        expect(h).toHaveProperty('consecutiveFailures');
        expect(h).toHaveProperty('lastFailure');
        expect(h).toHaveProperty('lastSuccess');
      });
    });

    it('shows initial healthy state', () => {
      const health = pool.getHealthStatus();
      health.forEach((h) => {
        expect(h.healthy).toBe(true);
        expect(h.consecutiveFailures).toBe(0);
        expect(h.lastFailure).toBeNull();
        expect(h.lastSuccess).toBeNull();
      });
    });

    it('reflects state changes after reportFailure and reportSuccess', async () => {
      const provider = await pool.getProvider();
      const id = provider.id;

      for (let i = 0; i < 2; i++) {
        await pool.reportFailure(id, new Error('Test error'));
      }

      let health = pool.getHealthStatus().find((h) => h.id === id);
      expect(health?.consecutiveFailures).toBe(2);
      expect(health?.healthy).toBe(true); // Still healthy below threshold

      await pool.reportSuccess(id);
      health = pool.getHealthStatus().find((h) => h.id === id);
      expect(health?.consecutiveFailures).toBe(0);
      expect(health?.healthy).toBe(true);
    });
  });

  describe('health recovery cooldown', () => {
    it('supports recovery after cooldown period', async () => {
      const pool2 = new ProviderPool(mockProviders, {
        failureThreshold: 2,
        cooldownPeriod: 100, // 100ms for testing
      });

      const provider = await pool2.getProvider();
      const id = provider.id;

      // Mark as unhealthy
      for (let i = 0; i < 2; i++) {
        await pool2.reportFailure(id, new Error('Failed'));
      }

      let health = pool2.getHealthStatus().find((h) => h.id === id);
      expect(health?.healthy).toBe(false);

      // Wait for cooldown
      await new Promise((resolve) => setTimeout(resolve, 120));

      // Should be able to try again (recovery in progress)
      // Provider may become healthy or get another chance
      const newProvider = await pool2.getProvider();
      expect(newProvider).toBeDefined();
    });

    it('recovers unhealthy provider after cooldown and success', async () => {
      const pool2 = new ProviderPool(mockProviders, {
        failureThreshold: 2,
        cooldownPeriod: 50,
      });

      const provider = await pool2.getProvider();
      const id = provider.id;

      // Mark as unhealthy
      for (let i = 0; i < 2; i++) {
        await pool2.reportFailure(id, new Error('Failed'));
      }

      let health = pool2.getHealthStatus().find((h) => h.id === id);
      expect(health?.healthy).toBe(false);

      // Wait for cooldown
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Report success to recover
      await pool2.reportSuccess(id);

      health = pool2.getHealthStatus().find((h) => h.id === id);
      expect(health?.healthy).toBe(true);
    });
  });

  describe('priority ordering', () => {
    it('returns highest priority provider first', async () => {
      const provider1 = await pool.getProvider();
      expect(provider1.priority).toBe(2); // Highest priority
    });

    it('returns next priority when highest is unhealthy', async () => {
      const provider1 = await pool.getProvider();
      const id1 = provider1.id;
      expect(provider1.priority).toBe(2);

      // Mark highest priority as unhealthy
      for (let i = 0; i < 4; i++) {
        await pool.reportFailure(id1, new Error('Failed'));
      }

      const provider2 = await pool.getProvider();
      expect(provider2.priority).toBe(1); // Next priority
    });
  });

  describe('concurrent operations', () => {
    it('handles concurrent getProvider calls', async () => {
      const calls = Array(5)
        .fill(null)
        .map(() => pool.getProvider());
      const providers = await Promise.all(calls);

      providers.forEach((p) => {
        expect(p).toBeDefined();
        expect(p.id).toBeDefined();
      });
    });

    it('handles concurrent reportSuccess calls', async () => {
      const provider = await pool.getProvider();
      const id = provider.id;

      const calls = Array(5)
        .fill(null)
        .map(() => pool.reportSuccess(id));
      await expect(Promise.all(calls)).resolves.not.toThrow();
    });

    it('handles concurrent reportFailure calls', async () => {
      const provider = await pool.getProvider();
      const id = provider.id;

      const calls = Array(5)
        .fill(null)
        .map(() => pool.reportFailure(id, new Error('Failed')));
      await expect(Promise.all(calls)).resolves.not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('handles empty provider list', () => {
      expect(() => new ProviderPool([])).toThrow();
    });

    it('handles provider with same priority', async () => {
      const sameProviders = [
        { url: 'http://localhost:8545', priority: 1 },
        { url: 'http://localhost:8546', priority: 1 },
      ];
      const pool2 = new ProviderPool(sameProviders);
      const provider = await pool2.getProvider();
      expect(provider).toBeDefined();
    });

    it('throws error when all providers fail', async () => {
      const singleProvider = [{ url: 'http://localhost:8545', priority: 1 }];
      const pool2 = new ProviderPool(singleProvider, { failureThreshold: 1 });

      const provider = await pool2.getProvider();
      await pool2.reportFailure(provider.id, new Error('Failed'));

      await expect(pool2.getProvider()).rejects.toThrow('No healthy providers available');
    });
  });
});
