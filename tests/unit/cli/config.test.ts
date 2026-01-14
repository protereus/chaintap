import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseConfig, loadConfigFile } from '../../../src/cli/config';
import { ConfigError } from '../../../src/utils/errors';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Config Schema Validation', () => {
  describe('parseConfig', () => {
    it('should parse valid config YAML', () => {
      const yaml = `
chain: ethereum
database:
  type: sqlite
  path: ./data/events.db

contracts:
  - address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
    name: "UNI Token"
    events:
      - Transfer
      - Approval

providers:
  - url: "https://eth.llamarpc.com"
`;

      const config = parseConfig(yaml);

      expect(config.chain).toBe('ethereum');
      expect(config.database.type).toBe('sqlite');
      expect(config.database.path).toBe('./data/events.db');
      expect(config.contracts).toHaveLength(1);
      expect(config.contracts[0].address).toBe('0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984');
      expect(config.contracts[0].name).toBe('UNI Token');
      expect(config.contracts[0].events).toEqual(['Transfer', 'Approval']);
      expect(config.providers).toHaveLength(1);
      expect(config.providers[0].url).toBe('https://eth.llamarpc.com');
    });

    it('should reject invalid contract address', () => {
      const yaml = `
chain: ethereum
database:
  type: sqlite
  path: ./data/events.db

contracts:
  - address: "not-an-address"
    name: "Invalid"
    events:
      - Transfer

providers:
  - url: "https://eth.llamarpc.com"
`;

      expect(() => parseConfig(yaml)).toThrow(ConfigError);
      expect(() => parseConfig(yaml)).toThrow(/address/i);
    });

    it('should reject missing chain field', () => {
      const yaml = `
database:
  type: sqlite
  path: ./data/events.db

contracts:
  - address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
    name: "Test"
    events:
      - Transfer

providers:
  - url: "https://eth.llamarpc.com"
`;

      expect(() => parseConfig(yaml)).toThrow(ConfigError);
      expect(() => parseConfig(yaml)).toThrow(/chain/i);
    });

    it('should reject missing contracts field', () => {
      const yaml = `
chain: ethereum
database:
  type: sqlite
  path: ./data/events.db

providers:
  - url: "https://eth.llamarpc.com"
`;

      expect(() => parseConfig(yaml)).toThrow(ConfigError);
      expect(() => parseConfig(yaml)).toThrow(/contracts/i);
    });

    it('should reject missing database field', () => {
      const yaml = `
chain: ethereum

contracts:
  - address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
    name: "Test"
    events:
      - Transfer

providers:
  - url: "https://eth.llamarpc.com"
`;

      expect(() => parseConfig(yaml)).toThrow(ConfigError);
      expect(() => parseConfig(yaml)).toThrow(/database/i);
    });

    it('should interpolate environment variables', () => {
      process.env.TEST_ALCHEMY_URL = 'https://eth-mainnet.alchemyapi.io/v2/test-key';
      process.env.TEST_DB_PATH = '/var/lib/chaintap/data.db';

      const yaml = `
chain: ethereum
database:
  type: sqlite
  path: \${TEST_DB_PATH}

contracts:
  - address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
    name: "Test"
    events:
      - Transfer

providers:
  - url: "\${TEST_ALCHEMY_URL}"
`;

      const config = parseConfig(yaml);

      expect(config.database.path).toBe('/var/lib/chaintap/data.db');
      expect(config.providers[0].url).toBe('https://eth-mainnet.alchemyapi.io/v2/test-key');

      delete process.env.TEST_ALCHEMY_URL;
      delete process.env.TEST_DB_PATH;
    });

    it('should throw error when environment variable is missing', () => {
      const yaml = `
chain: ethereum
database:
  type: sqlite
  path: ./data/events.db

contracts:
  - address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
    name: "Test"
    events:
      - Transfer

providers:
  - url: "\${MISSING_ENV_VAR}"
`;

      expect(() => parseConfig(yaml)).toThrow(ConfigError);
      expect(() => parseConfig(yaml)).toThrow(/MISSING_ENV_VAR/);
    });

    it('should default from_block to null when not specified', () => {
      const yaml = `
chain: ethereum
database:
  type: sqlite
  path: ./data/events.db

contracts:
  - address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
    name: "Test"
    events:
      - Transfer

providers:
  - url: "https://eth.llamarpc.com"
`;

      const config = parseConfig(yaml);

      expect(config.contracts[0].from_block).toBeNull();
    });

    it('should parse from_block when specified', () => {
      const yaml = `
chain: ethereum
database:
  type: sqlite
  path: ./data/events.db

contracts:
  - address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
    name: "Test"
    events:
      - Transfer
    from_block: 17000000

providers:
  - url: "https://eth.llamarpc.com"
`;

      const config = parseConfig(yaml);

      expect(config.contracts[0].from_block).toBe(17000000);
    });

    it('should parse multiple contracts in config', () => {
      const yaml = `
chain: ethereum
database:
  type: sqlite
  path: ./data/events.db

contracts:
  - address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
    name: "UNI Token"
    events:
      - Transfer
      - Approval
  - address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
    name: "USDC"
    events:
      - Transfer
    from_block: 18000000
  - address: "0xdAC17F958D2ee523a2206206994597C13D831ec7"
    name: "USDT"
    events:
      - Transfer

providers:
  - url: "https://eth.llamarpc.com"
`;

      const config = parseConfig(yaml);

      expect(config.contracts).toHaveLength(3);
      expect(config.contracts[0].name).toBe('UNI Token');
      expect(config.contracts[1].name).toBe('USDC');
      expect(config.contracts[1].from_block).toBe(18000000);
      expect(config.contracts[2].name).toBe('USDT');
    });

    it('should default provider priority to 1', () => {
      const yaml = `
chain: ethereum
database:
  type: sqlite
  path: ./data/events.db

contracts:
  - address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
    name: "Test"
    events:
      - Transfer

providers:
  - url: "https://eth.llamarpc.com"
`;

      const config = parseConfig(yaml);

      expect(config.providers[0].priority).toBe(1);
    });

    it('should parse provider priority when specified', () => {
      const yaml = `
chain: ethereum
database:
  type: sqlite
  path: ./data/events.db

contracts:
  - address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
    name: "Test"
    events:
      - Transfer

providers:
  - url: "https://eth.llamarpc.com"
    priority: 1
  - url: "https://backup.rpc.com"
    priority: 2
`;

      const config = parseConfig(yaml);

      expect(config.providers[0].priority).toBe(1);
      expect(config.providers[1].priority).toBe(2);
    });

    it('should apply default options when not specified', () => {
      const yaml = `
chain: ethereum
database:
  type: sqlite
  path: ./data/events.db

contracts:
  - address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
    name: "Test"
    events:
      - Transfer

providers:
  - url: "https://eth.llamarpc.com"
`;

      const config = parseConfig(yaml);

      expect(config.options.batch_size).toBe(2000);
      expect(config.options.confirmations).toBe(12);
      expect(config.options.poll_interval).toBe(15000);
      expect(config.options.max_retries).toBe(5);
    });

    it('should parse custom options when specified', () => {
      const yaml = `
chain: ethereum
database:
  type: sqlite
  path: ./data/events.db

contracts:
  - address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
    name: "Test"
    events:
      - Transfer

providers:
  - url: "https://eth.llamarpc.com"

options:
  batch_size: 5000
  confirmations: 6
  poll_interval: 30000
  max_retries: 10
`;

      const config = parseConfig(yaml);

      expect(config.options.batch_size).toBe(5000);
      expect(config.options.confirmations).toBe(6);
      expect(config.options.poll_interval).toBe(30000);
      expect(config.options.max_retries).toBe(10);
    });

    it('should parse partial custom options with defaults', () => {
      const yaml = `
chain: ethereum
database:
  type: sqlite
  path: ./data/events.db

contracts:
  - address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
    name: "Test"
    events:
      - Transfer

providers:
  - url: "https://eth.llamarpc.com"

options:
  batch_size: 3000
  confirmations: 20
`;

      const config = parseConfig(yaml);

      expect(config.options.batch_size).toBe(3000);
      expect(config.options.confirmations).toBe(20);
      expect(config.options.poll_interval).toBe(15000);
      expect(config.options.max_retries).toBe(5);
    });

    it('should validate chain enum values', () => {
      const yaml = `
chain: invalid_chain
database:
  type: sqlite
  path: ./data/events.db

contracts:
  - address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
    name: "Test"
    events:
      - Transfer

providers:
  - url: "https://eth.llamarpc.com"
`;

      expect(() => parseConfig(yaml)).toThrow(ConfigError);
      expect(() => parseConfig(yaml)).toThrow(/chain/i);
    });

    it('should accept all valid chain values', () => {
      const chains = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc'];

      chains.forEach((chain) => {
        const yaml = `
chain: ${chain}
database:
  type: sqlite
  path: ./data/events.db

contracts:
  - address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
    name: "Test"
    events:
      - Transfer

providers:
  - url: "https://eth.llamarpc.com"
`;

        const config = parseConfig(yaml);
        expect(config.chain).toBe(chain);
      });
    });

    it('should reject more than 100 contracts', () => {
      const contracts = Array.from({ length: 101 }, (_, i) => `
  - address: "0x${i.toString(16).padStart(40, '0')}"
    name: "Contract ${i}"
    events:
      - Transfer`).join('');

      const yaml = `
chain: ethereum
database:
  type: sqlite
  path: ./data/events.db

contracts:${contracts}

providers:
  - url: "https://eth.llamarpc.com"
`;

      expect(() => parseConfig(yaml)).toThrow(ConfigError);
      expect(() => parseConfig(yaml)).toThrow(/contracts/i);
    });

    it('should reject empty contracts array', () => {
      const yaml = `
chain: ethereum
database:
  type: sqlite
  path: ./data/events.db

contracts: []

providers:
  - url: "https://eth.llamarpc.com"
`;

      expect(() => parseConfig(yaml)).toThrow(ConfigError);
      expect(() => parseConfig(yaml)).toThrow(/contracts/i);
    });

    it('should reject empty providers array', () => {
      const yaml = `
chain: ethereum
database:
  type: sqlite
  path: ./data/events.db

contracts:
  - address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
    name: "Test"
    events:
      - Transfer

providers: []
`;

      expect(() => parseConfig(yaml)).toThrow(ConfigError);
      expect(() => parseConfig(yaml)).toThrow(/providers/i);
    });

    it('should parse optional abi field', () => {
      const yaml = `
chain: ethereum
database:
  type: sqlite
  path: ./data/events.db

contracts:
  - address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
    name: "Test"
    events:
      - Transfer
    abi: "./custom.json"

providers:
  - url: "https://eth.llamarpc.com"
`;

      const config = parseConfig(yaml);

      expect(config.contracts[0].abi).toBe('./custom.json');
    });

    it('should have helpful error messages', () => {
      const yaml = `
chain: ethereum
database:
  type: sqlite
  path: ./data/events.db

contracts:
  - address: "invalid"
    name: "Test"
    events:
      - Transfer

providers:
  - url: "https://eth.llamarpc.com"
`;

      try {
        parseConfig(yaml);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError);
        const message = (error as Error).message;
        expect(message).toMatch(/address/i);
        expect(message.length).toBeGreaterThan(20); // Should be descriptive
      }
    });
  });

  describe('loadConfigFile', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaintap-test-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should load and parse config from file', () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const yaml = `
chain: ethereum
database:
  type: sqlite
  path: ./data/events.db

contracts:
  - address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
    name: "UNI Token"
    events:
      - Transfer

providers:
  - url: "https://eth.llamarpc.com"
`;

      fs.writeFileSync(configPath, yaml);

      const config = loadConfigFile(configPath);

      expect(config.chain).toBe('ethereum');
      expect(config.contracts[0].name).toBe('UNI Token');
    });

    it('should throw ConfigError when file does not exist', () => {
      const configPath = path.join(tempDir, 'nonexistent.yaml');

      expect(() => loadConfigFile(configPath)).toThrow(ConfigError);
      expect(() => loadConfigFile(configPath)).toThrow(/not found/i);
    });

    it('should throw ConfigError when file is not readable', () => {
      const configPath = path.join(tempDir, 'config.yaml');
      fs.writeFileSync(configPath, 'test');
      fs.chmodSync(configPath, 0o000);

      try {
        // Skip test if running as root (permissions won't be enforced)
        if (process.getuid && process.getuid() === 0) {
          // Running as root, skip this test
          return;
        }
        expect(() => loadConfigFile(configPath)).toThrow(ConfigError);
        expect(() => loadConfigFile(configPath)).toThrow(/read/i);
      } finally {
        fs.chmodSync(configPath, 0o644);
      }
    });

    it('should throw ConfigError when YAML is malformed', () => {
      const configPath = path.join(tempDir, 'config.yaml');
      const yaml = `
chain: ethereum
  database:
type: sqlite
    invalid yaml structure
`;

      fs.writeFileSync(configPath, yaml);

      expect(() => loadConfigFile(configPath)).toThrow(ConfigError);
      expect(() => loadConfigFile(configPath)).toThrow(/parse/i);
    });
  });
});
