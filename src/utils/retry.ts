import pRetry from 'p-retry';
import { Logger } from './logger.js';

export interface RetryOptions {
  retries?: number;
  minTimeout?: number;
  maxTimeout?: number;
  factor?: number;
  logger?: Logger;
  operationName?: string;
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    logger,
    operationName = 'operation',
    retries = 5,
    minTimeout = 1000,
    maxTimeout = 30000,
    factor = 2,
    ...pRetryOpts
  } = options;

  return pRetry(fn, {
    retries,
    minTimeout,
    maxTimeout,
    factor,
    onFailedAttempt: error => {
      if (logger) {
        logger.warn(
          {
            attempt: error.attemptNumber,
            retriesLeft: error.retriesLeft,
            error: error.message,
          },
          `Retrying ${operationName}`
        );
      }
    },
    ...pRetryOpts,
  });
}
