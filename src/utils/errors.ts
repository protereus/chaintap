export class ChainTapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ConfigError extends ChainTapError {
  constructor(message: string) {
    super(message);
  }
}

export class RPCError extends ChainTapError {
  constructor(message: string, public providerId?: string) {
    super(message);
  }
}

export class StorageError extends ChainTapError {
  constructor(message: string) {
    super(message);
  }
}

export class ABIError extends ChainTapError {
  constructor(message: string) {
    super(message);
  }
}

export class FileSystemError extends ChainTapError {
  constructor(message: string) {
    super(message);
  }
}
