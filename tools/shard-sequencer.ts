/*
 * The order and split of the test files, by how long each took.
 *
 * Vitest's own `--shard` deals files out by a hash of their paths, so one shard
 * can be given every slow file and run into the job's time limit while the
 * others finish early. This one reads how long each file took in the last full
 * run, from `test-timings.json`, and deals the files out so each shard takes
 * about the same. A file the timings do not name is given the middle of them.
 * Regenerate the timings with `pnpm test:timings`.
 */

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

const TIMINGS = new URL('./test-timings.json', import.meta.url);

/** How long each file took in milliseconds, by its path from the root. Empty when there is no file yet. */
const timings = (): Record<string, number> => {
  try {
    return JSON.parse(readFileSync(TIMINGS, 'utf8')) as Record<string, number>;
  }
  catch {
    return {};
  }
};

export default class TimedSequencer extends BaseSequencer {
  async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { index, count } = this.ctx.config.shard ?? { index: 1, count: 1 };
    const root = this.ctx.config.root;
    const known = timings();
    const keyed = files.map((spec) => ({ spec, key: relative(root, spec.moduleId).split('\\').join('/') }));
    const sizes = keyed.map(({ key }) => known[key]).filter((ms): ms is number => ms !== undefined).sort((a, b) => a - b);
    // With no timing for any file, every file weighs the same, so the split is by count.
    const middle = sizes[Math.floor(sizes.length / 2)] ?? 1;
    // Longest first, each to the shard with the least time so far: the usual
    // way to split work of unequal size across a fixed number of workers.
    const dealt = keyed
      .map((one) => ({ ...one, ms: known[one.key] ?? middle }))
      .sort((a, b) => b.ms - a.ms || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const load = Array.from({ length: count }, () => 0);
    const bucket = Array.from({ length: count }, (): TestSpecification[] => []);
    for (const one of dealt) {
      let least = 0;
      for (let at = 1; at < count; at += 1) {
        if ((load[at] ?? 0) < (load[least] ?? 0)) least = at;
      }
      load[least] = (load[least] ?? 0) + one.ms;
      bucket[least]?.push(one.spec);
    }
    /*
     * One line on what the split was made from, so a run whose shards come out
     * uneven says whether the timings matched its files: a path spelled
     * differently on one system leaves every file untimed and the split by count.
     */
    const untimed = keyed.filter(({ key }) => known[key] === undefined);
    const shown = untimed[0] === undefined ? '' : `, e.g. ${untimed[0].key}`;
    process.stderr.write(`shard ${String(index)}/${String(count)}: ${String(bucket[index - 1]?.length ?? 0)} of ${String(files.length)} files, ${String(files.length - untimed.length)} timed${shown}, ${String(Math.round((load[index - 1] ?? 0) / 1000))} s recorded\n`);
    return bucket[index - 1] ?? [];
  }
}
