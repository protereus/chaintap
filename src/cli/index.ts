#!/usr/bin/env node
import { Command } from 'commander';
import { createWatchCommand } from './commands/watch.js';
import { createBackfillCommand } from './commands/backfill.js';
import { createStatusCommand } from './commands/status.js';

const program = new Command();

program
  .name('chaintap')
  .description('Zero-config blockchain event indexer')
  .version('0.1.0');

program.addCommand(createWatchCommand());
program.addCommand(createBackfillCommand());
program.addCommand(createStatusCommand());

program.parse();
