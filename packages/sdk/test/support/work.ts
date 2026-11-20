/*
 * The folder the host suites serve, and its URI.
 *
 * `tools/test-tmpdir.ts` names it inside the run's own temporary folder and
 * never makes it, so a host that lists, reads or runs git there finds the same
 * absent folder on every machine.
 *
 * Not a test file. `vitest` collects `*.test.ts`, and this is imported by the
 * suites that are.
 */

import { uriOf } from '../../src/resources/fileuri.js';

const named = process.env.AHPD_TEST_WORK;
if (named === undefined || named === '')
  throw new Error('AHPD_TEST_WORK is not set: run the suite through vitest, whose global setup is tools/test-tmpdir.ts.');

/** The folder a host here serves. */
export const WORK: string = named;

/** `WORK` as the URI a client sends and receives. */
export const WORK_URI: string = uriOf(WORK);

/** A temporary Git repository containing the filesystem suites' read fixtures. */
const repository = process.env.AHPD_TEST_REPOSITORY;
if (repository === undefined || repository === '')
  throw new Error('AHPD_TEST_REPOSITORY is not set: run the suite through vitest with tools/test-tmpdir.ts.');
export const REPOSITORY: string = repository;
