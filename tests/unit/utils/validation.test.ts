import { describe, it, expect } from 'vitest';
import {
  validateEthereumAddress,
  validateChainId,
  validateBlockNumber,
  ethereumAddressSchema,
} from '../../../src/utils/validation.js';

describe('Validation Utils', () => {
  describe('validateEthereumAddress', () => {
    it('validates correct Ethereum address', () => {
      expect(validateEthereumAddress('0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984')).toBe(true);
    });

    it('rejects invalid addresses', () => {
      expect(validateEthereumAddress('0xZZZ')).toBe(false);
      expect(validateEthereumAddress('1f9840a85d5aF5bf1D1762F925BDADdC4201F984')).toBe(false); // Missing 0x
      expect(validateEthereumAddress('0x1f9840')).toBe(false); // Too short
    });
  });

  describe('validateChainId', () => {
    it('validates positive chain IDs', () => {
      expect(validateChainId(1)).toBe(true);
      expect(validateChainId(137)).toBe(true);
    });

    it('rejects invalid chain IDs', () => {
      expect(validateChainId(0)).toBe(false);
      expect(validateChainId(-1)).toBe(false);
      expect(validateChainId(1.5)).toBe(false);
    });
  });

  describe('validateBlockNumber', () => {
    it('validates non-negative block numbers', () => {
      expect(validateBlockNumber(0)).toBe(true);
      expect(validateBlockNumber(17000000)).toBe(true);
    });

    it('rejects invalid block numbers', () => {
      expect(validateBlockNumber(-1)).toBe(false);
      expect(validateBlockNumber(1.5)).toBe(false);
    });
  });

  describe('ethereumAddressSchema', () => {
    it('parses valid address', () => {
      const result = ethereumAddressSchema.safeParse('0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984');
      expect(result.success).toBe(true);
    });

    it('rejects invalid address with error message', () => {
      const result = ethereumAddressSchema.safeParse('0xZZZ');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('Invalid Ethereum address format');
      }
    });
  });
});
