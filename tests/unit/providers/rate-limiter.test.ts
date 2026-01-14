import { describe, it, expect } from 'vitest';
import { isRateLimitError, isTimeoutError } from '../../../src/providers/rate-limiter.js';

describe('Rate Limiter Utils', () => {
  describe('isRateLimitError', () => {
    it('detects 429 status code in error message', () => {
      const error = new Error('HTTP 429 Too Many Requests');
      expect(isRateLimitError(error)).toBe(true);
    });

    it('detects "rate limit" string (case insensitive)', () => {
      const error = new Error('Rate limit exceeded');
      expect(isRateLimitError(error)).toBe(true);

      const error2 = new Error('RATE LIMIT EXCEEDED');
      expect(isRateLimitError(error2)).toBe(true);
    });

    it('detects "too many requests" phrase', () => {
      const error = new Error('Too many requests sent to the API');
      expect(isRateLimitError(error)).toBe(true);
    });

    it('detects "quota exceeded" phrase', () => {
      const error = new Error('Request quota exceeded');
      expect(isRateLimitError(error)).toBe(true);
    });

    it('returns false for non-rate-limit errors', () => {
      const error = new Error('Connection refused');
      expect(isRateLimitError(error)).toBe(false);
    });

    it('handles string errors', () => {
      expect(isRateLimitError('429 Too Many Requests')).toBe(true);
      expect(isRateLimitError('rate limit error')).toBe(true);
      expect(isRateLimitError('other error')).toBe(false);
    });

    it('handles null and undefined', () => {
      expect(isRateLimitError(null)).toBe(false);
      expect(isRateLimitError(undefined)).toBe(false);
    });

    it('handles objects without message property', () => {
      expect(isRateLimitError({})).toBe(false);
      expect(isRateLimitError({ code: 429 })).toBe(false);
    });

    it('detects "429" in error code property', () => {
      const error = { code: 429, message: 'too many requests' };
      expect(isRateLimitError(error)).toBe(true);
    });

    it('detects rate limit in error string representation', () => {
      const error = { toString: () => '429 rate limited' };
      expect(isRateLimitError(error)).toBe(true);
    });
  });

  describe('isTimeoutError', () => {
    it('detects "timeout" string (case insensitive)', () => {
      const error = new Error('Request timeout');
      expect(isTimeoutError(error)).toBe(true);

      const error2 = new Error('TIMEOUT');
      expect(isTimeoutError(error2)).toBe(true);
    });

    it('detects "ETIMEDOUT" error code', () => {
      const error = new Error('ETIMEDOUT');
      expect(isTimeoutError(error)).toBe(true);
    });

    it('detects "ECONNRESET" error code', () => {
      const error = new Error('ECONNRESET');
      expect(isTimeoutError(error)).toBe(true);
    });

    it('detects socket timeout', () => {
      const error = new Error('socket hang up');
      expect(isTimeoutError(error)).toBe(true);
    });

    it('returns false for non-timeout errors', () => {
      const error = new Error('Invalid JSON');
      expect(isTimeoutError(error)).toBe(false);
    });

    it('handles string errors', () => {
      expect(isTimeoutError('Connection timeout')).toBe(true);
      expect(isTimeoutError('ETIMEDOUT')).toBe(true);
      expect(isTimeoutError('other error')).toBe(false);
    });

    it('handles null and undefined', () => {
      expect(isTimeoutError(null)).toBe(false);
      expect(isTimeoutError(undefined)).toBe(false);
    });

    it('handles objects without message property', () => {
      expect(isTimeoutError({})).toBe(false);
    });

    it('detects timeout in error code property', () => {
      const error = { code: 'ETIMEDOUT', message: 'connection timed out' };
      expect(isTimeoutError(error)).toBe(true);
    });

    it('detects timeout in error string representation', () => {
      const error = { toString: () => 'Socket timeout' };
      expect(isTimeoutError(error)).toBe(true);
    });

    it('handles network-related timeout errors', () => {
      const errors = [
        new Error('net.Socket timeout'),
        new Error('ECONNRESET: Connection reset by peer'),
        new Error('socket timeout'),
      ];
      errors.forEach((error) => {
        expect(isTimeoutError(error)).toBe(true);
      });
    });
  });
});
