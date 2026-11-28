import { describe, expect, it } from 'vitest';
import { isWrapperCommand, wrapperExecutable } from '../src/self-command.js';

const STORE = '/nix/store/r631q12dbiy1qcmh59ammfzmbmq1k2hp-ahpd-trial-0.15.0-rc.4-source.fba91316';
const PACKAGED_MODULE = `file://${STORE}/lib/ahpd-trial/packages/services/dist/self-command.js`;
const CHECKOUT_MODULE = 'file:///hh/var/@dev/luna6/39156-compose/packages/services/src/self-command.ts';

describe('the executable word a wrapper line names (#39156 B)', () => {
  it('answers this install\u2019s own bin/ahpd when the module runs from a packaged tree', () => {
    expect(wrapperExecutable(PACKAGED_MODULE, (path) => path === `${STORE}/bin/ahpd`)).toBe(`${STORE}/bin/ahpd`);
  });

  it('keeps the bare word when the packaged tree ships no bin/ahpd', () => {
    expect(wrapperExecutable(PACKAGED_MODULE, () => false)).toBe('ahpd');
  });

  it('stops at the checkout, so an unrelated bin/ahpd above the repository is never named', () => {
    const at = (path: string): boolean =>
      path === '/hh/bin/ahpd' || path === '/hh/var/@dev/luna6/39156-compose/.git';
    expect(wrapperExecutable(CHECKOUT_MODULE, at)).toBe('ahpd');
  });

  it('recognises both executable words as the wrapper, and nothing else', () => {
    expect(isWrapperCommand("ahpd secrets exec web -- 'serve'")).toBe(true);
    expect(isWrapperCommand(`${STORE}/bin/ahpd secrets exec web -- 'serve'`)).toBe(true);
    expect(isWrapperCommand('bun run serve')).toBe(false);
    expect(isWrapperCommand('ahpd run web')).toBe(false);
    expect(isWrapperCommand('ahpd secrets exec')).toBe(false);
  });
});
