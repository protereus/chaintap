import Database from 'better-sqlite3';
import { StorageAdapter, EventFilter } from './adapter.js';
import { DecodedEvent } from '../core/types.js';
import { StorageError } from '../utils/errors.js';

export class SQLiteAdapter implements StorageAdapter {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async init(): Promise<void> {
    try {
      this.db = new Database(this.dbPath);

      // Enable WAL mode for better concurrent access
      this.db.pragma('journal_mode = WAL');

      // Create events table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contract_address TEXT NOT NULL,
          block_number INTEGER NOT NULL,
          block_timestamp INTEGER NOT NULL,
          transaction_hash TEXT NOT NULL,
          log_index INTEGER NOT NULL,
          event_name TEXT NOT NULL,
          event_data TEXT NOT NULL,
          indexed_at INTEGER NOT NULL,
          UNIQUE(transaction_hash, log_index)
        );
      `);

      // Create indexes
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_contract_block ON events(contract_address, block_number);
        CREATE INDEX IF NOT EXISTS idx_contract_event ON events(contract_address, event_name);
        CREATE INDEX IF NOT EXISTS idx_block_number ON events(block_number);
      `);

      // Create sync_state table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS sync_state (
          contract_address TEXT PRIMARY KEY,
          chain_id INTEGER NOT NULL,
          last_block INTEGER NOT NULL,
          last_sync INTEGER NOT NULL,
          status TEXT DEFAULT 'active'
        );
      `);
    } catch (error) {
      throw new StorageError(
        `Failed to initialize database: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async insertEvents(events: DecodedEvent[]): Promise<number> {
    this.ensureDb();

    if (events.length === 0) {
      return 0;
    }

    try {
      const stmt = this.db!.prepare(`
        INSERT OR IGNORE INTO events (
          contract_address,
          block_number,
          block_timestamp,
          transaction_hash,
          log_index,
          event_name,
          event_data,
          indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertMany = this.db!.transaction((events: DecodedEvent[]) => {
        let insertedCount = 0;
        for (const event of events) {
          const result = stmt.run(
            event.contractAddress,
            event.blockNumber,
            event.blockTimestamp,
            event.transactionHash,
            event.logIndex,
            event.eventName,
            JSON.stringify(event.eventData),
            Math.floor(Date.now() / 1000)
          );
          // If changes > 0, the insert was successful (not ignored due to duplicate)
          if (result.changes > 0) {
            insertedCount++;
          }
        }
        return insertedCount;
      });

      return insertMany(events);
    } catch (error) {
      throw new StorageError(
        `Failed to insert events: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getLastSyncedBlock(contractAddress: string): Promise<number | null> {
    this.ensureDb();

    try {
      const stmt = this.db!.prepare(`
        SELECT last_block FROM sync_state WHERE contract_address = ?
      `);

      const result = stmt.get(contractAddress) as { last_block: number } | undefined;
      return result?.last_block ?? null;
    } catch (error) {
      throw new StorageError(
        `Failed to get last synced block: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async updateSyncStateAndInsertEvents(
    contractAddress: string,
    chainId: number,
    blockNumber: number,
    events: DecodedEvent[]
  ): Promise<void> {
    this.ensureDb();

    try {
      const updateTransaction = this.db!.transaction(() => {
        // Update sync state
        const syncStmt = this.db!.prepare(`
          INSERT INTO sync_state (contract_address, chain_id, last_block, last_sync)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(contract_address) DO UPDATE SET
            last_block = excluded.last_block,
            last_sync = excluded.last_sync
        `);

        syncStmt.run(
          contractAddress,
          chainId,
          blockNumber,
          Math.floor(Date.now() / 1000)
        );

        // Insert events if any
        if (events.length > 0) {
          const eventStmt = this.db!.prepare(`
            INSERT OR IGNORE INTO events (
              contract_address,
              block_number,
              block_timestamp,
              transaction_hash,
              log_index,
              event_name,
              event_data,
              indexed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);

          for (const event of events) {
            eventStmt.run(
              event.contractAddress,
              event.blockNumber,
              event.blockTimestamp,
              event.transactionHash,
              event.logIndex,
              event.eventName,
              JSON.stringify(event.eventData),
              Math.floor(Date.now() / 1000)
            );
          }
        }
      });

      updateTransaction();
    } catch (error) {
      throw new StorageError(
        `Failed to update sync state and insert events: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async queryEvents(filter: EventFilter): Promise<DecodedEvent[]> {
    this.ensureDb();

    try {
      let query = 'SELECT * FROM events WHERE 1=1';
      const params: unknown[] = [];

      if (filter.contractAddress) {
        query += ' AND contract_address = ?';
        params.push(filter.contractAddress);
      }

      if (filter.eventName) {
        query += ' AND event_name = ?';
        params.push(filter.eventName);
      }

      if (filter.fromBlock !== undefined) {
        query += ' AND block_number >= ?';
        params.push(filter.fromBlock);
      }

      if (filter.toBlock !== undefined) {
        query += ' AND block_number <= ?';
        params.push(filter.toBlock);
      }

      // Order by block number and log index for consistent ordering
      query += ' ORDER BY block_number ASC, log_index ASC';

      // Handle LIMIT and OFFSET
      // Note: SQLite requires LIMIT when using OFFSET
      if (filter.limit !== undefined) {
        query += ' LIMIT ?';
        params.push(filter.limit);

        if (filter.offset !== undefined) {
          query += ' OFFSET ?';
          params.push(filter.offset);
        }
      } else if (filter.offset !== undefined) {
        // If only offset is provided, use a very large limit
        query += ' LIMIT ? OFFSET ?';
        params.push(Number.MAX_SAFE_INTEGER);
        params.push(filter.offset);
      }

      const stmt = this.db!.prepare(query);
      const rows = stmt.all(...params) as Array<{
        contract_address: string;
        block_number: number;
        block_timestamp: number;
        transaction_hash: string;
        log_index: number;
        event_name: string;
        event_data: string;
      }>;

      return rows.map(row => ({
        contractAddress: row.contract_address,
        blockNumber: row.block_number,
        blockTimestamp: row.block_timestamp,
        transactionHash: row.transaction_hash,
        logIndex: row.log_index,
        eventName: row.event_name,
        eventData: JSON.parse(row.event_data) as Record<string, unknown>
      }));
    } catch (error) {
      throw new StorageError(
        `Failed to query events: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      try {
        this.db.close();
        this.db = null;
      } catch (error) {
        throw new StorageError(
          `Failed to close database: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  private ensureDb(): void {
    if (!this.db) {
      throw new StorageError('Database not initialized or already closed');
    }
  }
}
