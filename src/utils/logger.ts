import pino from 'pino';

export function createLogger(verbose = false) {
  const level = verbose ? 'debug' : 'info';

  return pino({
    level,
    transport:
      process.env.NODE_ENV !== 'production'
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:HH:MM:ss',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
  });
}

export type Logger = ReturnType<typeof createLogger>;
