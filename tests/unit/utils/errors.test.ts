import { describe, it, expect } from 'vitest';
import {
  ChainTapError,
  ConfigError,
  RPCError,
  StorageError,
  ABIError,
  FileSystemError,
} from '../../../src/utils/errors.js';

describe('Error Classes', () => {
  it('creates ChainTapError with correct name', () => {
    const error = new ChainTapError('test message');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ChainTapError);
    expect(error.name).toBe('ChainTapError');
    expect(error.message).toBe('test message');
  });

  it('creates ConfigError', () => {
    const error = new ConfigError('config failed');
    expect(error).toBeInstanceOf(ChainTapError);
    expect(error.name).toBe('ConfigError');
    expect(error.message).toBe('config failed');
  });

  it('creates RPCError with optional providerId', () => {
    const error = new RPCError('rpc failed', 'provider-1');
    expect(error).toBeInstanceOf(ChainTapError);
    expect(error.name).toBe('RPCError');
    expect(error.message).toBe('rpc failed');
    expect(error.providerId).toBe('provider-1');
  });

  it('creates RPCError without providerId', () => {
    const error = new RPCError('rpc failed');
    expect(error.providerId).toBeUndefined();
  });

  it('creates StorageError', () => {
    const error = new StorageError('storage failed');
    expect(error).toBeInstanceOf(ChainTapError);
    expect(error.name).toBe('StorageError');
  });

  it('creates ABIError', () => {
    const error = new ABIError('abi failed');
    expect(error).toBeInstanceOf(ChainTapError);
    expect(error.name).toBe('ABIError');
  });

  it('creates FileSystemError', () => {
    const error = new FileSystemError('fs failed');
    expect(error).toBeInstanceOf(ChainTapError);
    expect(error.name).toBe('FileSystemError');
  });
});
