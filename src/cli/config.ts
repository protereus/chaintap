import { z } from 'zod';
import * as yaml from 'yaml';
import * as fs from 'node:fs';
import { ConfigError } from '../utils/errors.js';

// Ethereum address validation regex
const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

// Chain enum
const ChainSchema = z.enum([
  'ethereum',
  'polygon',
  'arbitrum',
  'optimism',
  'base',
  'bsc',
]);

// Contract configuration schema
const ContractConfigSchema = z.object({
  address: z.string().regex(ETH_ADDRESS_REGEX, {
    message: 'Invalid Ethereum address format. Must be 0x followed by 40 hex characters.',
  }),
  name: z.string().optional(),
  events: z.array(z.string().min(1)).min(1, 'At least one event is required'),
  from_block: z.number().int().nonnegative().nullable().default(null),
  abi: z.string().optional(),
});

// Provider configuration schema
const ProviderConfigSchema = z.object({
  url: z.string().url('Provider URL must be a valid URL'),
  priority: z.number().int().positive().default(1),
});

// Database configuration schema
const DatabaseConfigSchema = z.object({
  type: z.literal('sqlite'),
  path: z.string().min(1, 'Database path is required'),
});

// Options configuration schema
const OptionsConfigSchema = z.object({
  batch_size: z.number().int().positive().default(2000),
  confirmations: z.number().int().nonnegative().default(12),
  poll_interval: z.number().int().positive().default(15000),
  max_retries: z.number().int().positive().default(5),
}).default({
  batch_size: 2000,
  confirmations: 12,
  poll_interval: 15000,
  max_retries: 5,
});

// Main config schema
const ConfigSchema = z.object({
  chain: ChainSchema,
  database: DatabaseConfigSchema,
  contracts: z.array(ContractConfigSchema)
    .min(1, 'At least one contract is required')
    .max(100, 'Maximum of 100 contracts allowed'),
  providers: z.array(ProviderConfigSchema).min(1, 'At least one provider is required'),
  options: OptionsConfigSchema,
});

// Export inferred type
export type Config = z.infer<typeof ConfigSchema>;
export type ContractConfig = z.infer<typeof ContractConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;
export type OptionsConfig = z.infer<typeof OptionsConfigSchema>;
export type Chain = z.infer<typeof ChainSchema>;

/**
 * Interpolates environment variables in a string using ${VAR_NAME} syntax
 * @param str The string to interpolate
 * @returns The interpolated string
 * @throws ConfigError if a referenced environment variable is not set
 */
function interpolateEnvVars(str: string): string {
  return str.replace(/\$\{(\w+)\}/g, (_, varName) => {
    const value = process.env[varName];
    if (value === undefined) {
      throw new ConfigError(
        `Environment variable ${varName} is not set. ` +
        `Please set it before running chaintap or remove it from the config.`
      );
    }
    return value;
  });
}

/**
 * Recursively interpolates environment variables in an object
 * @param obj The object to process
 * @returns The processed object with interpolated values
 */
function interpolateObjectEnvVars(obj: any): any {
  if (typeof obj === 'string') {
    return interpolateEnvVars(obj);
  } else if (Array.isArray(obj)) {
    return obj.map(interpolateObjectEnvVars);
  } else if (obj !== null && typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateObjectEnvVars(value);
    }
    return result;
  }
  return obj;
}

/**
 * Parses and validates config from YAML content
 * @param yamlContent The YAML content as a string
 * @returns The validated config object
 * @throws ConfigError if parsing or validation fails
 */
export function parseConfig(yamlContent: string): Config {
  let parsed: any;

  // Parse YAML
  try {
    parsed = yaml.parse(yamlContent);
  } catch (error) {
    throw new ConfigError(
      `Failed to parse YAML configuration: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new ConfigError('Configuration file is empty or invalid');
  }

  // Interpolate environment variables
  try {
    parsed = interpolateObjectEnvVars(parsed);
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    throw new ConfigError(
      `Failed to interpolate environment variables: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  // Validate with Zod schema
  try {
    return ConfigSchema.parse(parsed);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(issue => {
        const path = issue.path.join('.');
        return `  - ${path ? path + ': ' : ''}${issue.message}`;
      }).join('\n');

      throw new ConfigError(
        `Configuration validation failed:\n${issues}\n\n` +
        `Please check your config file and ensure all required fields are present and valid.`
      );
    }
    throw new ConfigError(
      `Failed to validate configuration: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Loads and parses config from a file
 * @param path The path to the config file
 * @returns The validated config object
 * @throws ConfigError if file cannot be read or config is invalid
 */
export function loadConfigFile(path: string): Config {
  let content: string;

  // Read file
  try {
    content = fs.readFileSync(path, 'utf-8');
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new ConfigError(
        `Configuration file not found at path: ${path}\n` +
        `Please ensure the file exists and the path is correct.`
      );
    } else if (error.code === 'EACCES') {
      throw new ConfigError(
        `Permission denied when reading configuration file: ${path}\n` +
        `Please check file permissions.`
      );
    }
    throw new ConfigError(
      `Failed to read configuration file: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  // Parse config
  return parseConfig(content);
}
