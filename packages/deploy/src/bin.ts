#!/usr/bin/env node
/**
 * The bin npm links, and nothing else (#38280).
 *
 * A bin is reached through a symlink, so `process.argv[1]` is the link while `import.meta.url` is the file it points
 * at: a module that decides "am I the entry point?" by comparing them silently exits 0 when installed. This file is
 * always the entry point, so it never asks, and `cli.ts` stays importable without a side effect.
 */
import { run } from './cli.js';

process.exit(await run(process.argv.slice(2)));
