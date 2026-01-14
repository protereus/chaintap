# ChainTap

> Zero-config blockchain event indexer. Index EVM chain events to SQLite without GraphQL, AssemblyScript, or complex setup.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Zero Config**: Just specify contract address and event names - no GraphQL schemas or AssemblyScript
- **Automatic Pagination**: Handles RPC block range limits automatically
- **Multi-Provider Failover**: Automatic failover on rate limits with health tracking
- **Resumable**: Picks up where it left off after interruption
- **SQLite Storage**: No external database setup required
- **EVM Compatible**: Supports Ethereum, Polygon, Arbitrum, Optimism, Base, BSC

## Quick Start

### Installation

```bash
npm install -g chaintap
```

### Create Config File

```bash
cat > chaintap.yaml <<EOF
chain: ethereum
database:
  type: sqlite
  path: ./events.db

contracts:
  - address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
    name: "UNI Token"
    events:
      - Transfer
      - Approval
    from_block: 17000000

providers:
  - url: "https://eth.llamarpc.com"
    priority: 1
EOF
```

### Start Indexing

```bash
# Real-time indexing
chaintap watch

# Backfill historical data
chaintap backfill --from-block 17000000 --to-block 17100000

# Check sync status
chaintap status
```

## Configuration

See [chaintap.example.yaml](./chaintap.example.yaml) for a full configuration example.

### Required Fields

- `chain`: Target blockchain (ethereum, polygon, arbitrum, optimism, base, bsc)
- `database`: SQLite configuration with path
- `contracts`: Array of contracts to index (address, events)
- `providers`: Array of RPC provider URLs with priorities

### Optional Fields

- `from_block`: Start block for indexing (defaults to latest)
- `abi`: Custom ABI file path (defaults to Etherscan API)
- `options`: Batch size, confirmations, poll interval, max retries

### Environment Variables

Use `${VAR_NAME}` syntax in config for environment variable interpolation:

```yaml
providers:
  - url: "${ALCHEMY_URL}"
    priority: 1
```

## Querying Events

Events are stored in SQLite with this schema:

```sql
SELECT * FROM events
WHERE contract_address = '0x...'
  AND event_name = 'Transfer'
  AND block_number BETWEEN 17000000 AND 17010000
ORDER BY block_number, log_index;
```

### Schema

```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_address TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  block_timestamp INTEGER NOT NULL,
  transaction_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  event_name TEXT NOT NULL,
  event_data TEXT NOT NULL,  -- JSON
  indexed_at INTEGER NOT NULL,
  UNIQUE(transaction_hash, log_index)
);
```

## Commands

### `chaintap watch`

Start live indexing from latest block (or last synced block).

**Options:**
- `--config <path>` - Config file path (default: ./chaintap.yaml)
- `--verbose` - Enable verbose logging

**Example:**
```bash
chaintap watch --config ./my-config.yaml --verbose
```

### `chaintap backfill`

Sync historical data for a specific block range.

**Options:**
- `--from-block <number>` - Start block (required)
- `--to-block <number|latest>` - End block (required)
- `--config <path>` - Config file path (default: ./chaintap.yaml)

**Example:**
```bash
chaintap backfill --from-block 17000000 --to-block latest
```

### `chaintap status`

Show sync progress for all configured contracts.

**Options:**
- `--config <path>` - Config file path (default: ./chaintap.yaml)

**Example Output:**
```
Contract: UNI Token (0x1f98...)
  Chain: ethereum (chain_id: 1)
  Events: Transfer, Approval
  Last synced block: 19000050
  Total events: 15,234
  Status: active
```

## Requirements

- Node.js 18+
- RPC provider URL (Alchemy, Infura, or public RPC)
- (Optional) Etherscan API key for ABI fetching

## Architecture

ChainTap uses a modular architecture:

1. **ABI Fetcher**: Retrieves contract ABIs from block explorers with local caching
2. **Event Decoder**: Decodes raw event logs using ethers.js
3. **Event Fetcher**: Handles paginated `getLogs` calls with dynamic block range adjustment
4. **Provider Pool**: Manages multiple RPC providers with automatic failover
5. **Storage Adapter**: SQLite storage with atomic transactions
6. **Indexer**: Orchestrates all components

## Programmatic Usage

ChainTap can also be used as a library:

```typescript
import { Indexer, SQLiteAdapter, ProviderPool, loadConfigFile } from 'chaintap';
import { createLogger } from 'chaintap/utils/logger';

const config = loadConfigFile('./chaintap.yaml');
const storage = new SQLiteAdapter(config.database.path);
await storage.init();

const providerPool = new ProviderPool(config.providers);
const logger = createLogger(false);

const indexer = new Indexer(config, storage, providerPool, logger);
await indexer.startWatch();
```

## Performance

- **Historical sync**: 10,000+ blocks/minute (depends on RPC provider)
- **Live indexing**: < 30 second latency
- **Memory usage**: < 256MB for typical workloads
- **SQLite throughput**: 5,000+ events/second with batch inserts

## Troubleshooting

### "Contract ABI not verified on Etherscan"

Provide a manual ABI file in your config:

```yaml
contracts:
  - address: "0x..."
    abi: "./abis/mycontract.json"
    events: ["MyEvent"]
```

### "Block range too large" errors

ChainTap automatically adjusts block range sizes. If you still see errors, check your RPC provider's documentation for limits.

### Rate limit errors

Add more providers to your config with different priorities:

```yaml
providers:
  - url: "https://eth.llamarpc.com"
    priority: 1
  - url: "${ALCHEMY_URL}"
    priority: 2
```

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT © ChainTap

## Support

- GitHub Issues: https://github.com/protereus/chaintap/issues
- Documentation: https://github.com/protereus/chaintap

