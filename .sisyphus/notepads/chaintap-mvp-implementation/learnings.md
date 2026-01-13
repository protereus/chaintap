# Storage Layer Implementation Learnings

## SQLite Adapter - TDD Approach

### Implementation Date
2026-01-13

### Key Decisions
1. **Better-sqlite3 Library**: Chose synchronous better-sqlite3 over async sqlite3 for simpler transaction handling and better performance
2. **WAL Mode**: Enabled Write-Ahead Logging (PRAGMA journal_mode = WAL) for concurrent read access
3. **Single Events Table**: Used one unified events table with contract_address filtering instead of table-per-contract approach
4. **JSON Serialization**: Stored eventData as JSON TEXT column for flexible schema

### Technical Patterns
1. **Transaction Management**: Used `db.transaction()` for atomic operations in `updateSyncStateAndInsertEvents`
2. **Duplicate Handling**: Used `INSERT OR IGNORE` with UNIQUE(transaction_hash, log_index) constraint
3. **Unix Timestamps**: Used `Math.floor(Date.now() / 1000)` for indexed_at and last_sync fields
4. **Type Safety**: Better-sqlite3 synchronous API returns typed results directly

### SQL Gotchas
1. **OFFSET Requires LIMIT**: SQLite requires LIMIT when using OFFSET. Solution: use `LIMIT Number.MAX_SAFE_INTEGER` when only offset is provided
2. **Index Strategy**: Created composite indexes on (contract_address, block_number) and (contract_address, event_name) for efficient filtering

### Test Coverage
Comprehensive test suite covering:
- Table creation and initialization
- Batch inserts (100 events)
- Duplicate event handling
- Atomic transactions (sync state + events)
- Query filtering (contract, event name, block range, limit, offset)
- Edge cases (empty arrays, null results, closed database)
- Error handling with StorageError

### Performance Considerations
1. **Batch Inserts**: Transaction wrapper counts actual insertions (excluding duplicates)
2. **Query Ordering**: ORDER BY block_number ASC, log_index ASC for consistent results
3. **Prepared Statements**: Used for all queries for performance and SQL injection prevention

### Error Handling Pattern
All database errors caught and wrapped in StorageError with descriptive messages. Database state checked via `ensureDb()` helper before operations.
