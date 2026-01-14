/**
 * Utility functions for detecting rate limit and timeout errors
 */

/**
 * Check if an error is a rate limit error
 * Detects: 429 status codes, "rate limit", "too many requests", "quota exceeded"
 */
export function isRateLimitError(error: unknown): boolean {
  if (error === null || error === undefined) {
    return false;
  }

  // Check for message property specifically (not just any string representation)
  if (error instanceof Error || (typeof error === 'object' && error !== null && 'message' in error)) {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string') {
      const lowerError = message.toLowerCase();
      return (
        lowerError.includes('429') ||
        lowerError.includes('rate limit') ||
        lowerError.includes('too many requests') ||
        lowerError.includes('quota exceeded')
      );
    }
  }

  // Check string directly
  if (typeof error === 'string') {
    const lowerError = error.toLowerCase();
    return (
      lowerError.includes('429') ||
      lowerError.includes('rate limit') ||
      lowerError.includes('too many requests') ||
      lowerError.includes('quota exceeded')
    );
  }

  // Check string representation last
  if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>;
    if (typeof obj.toString === 'function') {
      try {
        const str = obj.toString();
        if (typeof str === 'string' && str !== '[object Object]') {
          const lowerError = str.toLowerCase();
          return (
            lowerError.includes('429') ||
            lowerError.includes('rate limit') ||
            lowerError.includes('too many requests') ||
            lowerError.includes('quota exceeded')
          );
        }
      } catch {
        // Fall through
      }
    }
  }

  return false;
}

/**
 * Check if an error is a timeout error
 * Detects: "timeout", "ETIMEDOUT", "ECONNRESET", socket errors
 */
export function isTimeoutError(error: unknown): boolean {
  if (error === null || error === undefined) {
    return false;
  }

  // Check for code property first (for error codes)
  if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>;
    if (typeof obj.code === 'string' || typeof obj.code === 'number') {
      const code = String(obj.code).toLowerCase();
      if (
        code.includes('timeout') ||
        code.includes('etimedout') ||
        code.includes('econnreset')
      ) {
        return true;
      }
    }
  }

  // Check for message property
  if (error instanceof Error || (typeof error === 'object' && error !== null && 'message' in error)) {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string') {
      const lowerError = message.toLowerCase();
      return (
        lowerError.includes('timeout') ||
        lowerError.includes('etimedout') ||
        lowerError.includes('econnreset') ||
        lowerError.includes('socket')
      );
    }
  }

  // Check string directly
  if (typeof error === 'string') {
    const lowerError = error.toLowerCase();
    return (
      lowerError.includes('timeout') ||
      lowerError.includes('etimedout') ||
      lowerError.includes('econnreset') ||
      lowerError.includes('socket')
    );
  }

  // Check string representation last
  if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>;
    if (typeof obj.toString === 'function') {
      try {
        const str = obj.toString();
        if (typeof str === 'string' && str !== '[object Object]') {
          const lowerError = str.toLowerCase();
          return (
            lowerError.includes('timeout') ||
            lowerError.includes('etimedout') ||
            lowerError.includes('econnreset') ||
            lowerError.includes('socket')
          );
        }
      } catch {
        // Fall through
      }
    }
  }

  return false;
}

