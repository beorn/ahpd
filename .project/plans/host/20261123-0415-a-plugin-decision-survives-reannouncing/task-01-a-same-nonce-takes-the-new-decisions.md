---
title: A same nonce takes the new decisions
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/tooling.ts#L1263-L1317](../../../../packages/sdk/src/host/tooling.ts#L1263-L1317) - `reconcile`, which keeps the old `HeldPlugin` and returns early"
  - "[code://packages/sdk/src/host/tooling.ts#L1247-L1249](../../../../packages/sdk/src/host/tooling.ts#L1247-L1249) - `signatureOf`, which must see a moved decision"
  - "[code://packages/sdk/test/client-plugins-session.test.ts#L345](../../../../packages/sdk/test/client-plugins-session.test.ts#L345) - the case that an unchanged announcement says nothing"
---

## Objective

When a client announces a plugin again with the same `nonce` and different `enablement` or `childEnablement`, the session's list carries the new decisions.
The host says the plugin again with `session/customizationUpdated`, and does not copy it again.

## Files

- `UPDATE: packages/sdk/src/host/tooling.ts:1247-1249` - `signatureOf` adds each plugin's `enablement` and `childEnablement` to the URI and the `nonce`.
- `UPDATE: packages/sdk/src/host/tooling.ts:1263-1317` - `reconcile` stores the new `announced` on a kept `HeldPlugin` and says each kept plugin whose decisions moved.
- `UPDATE: packages/sdk/test/client-plugins-session.test.ts` - a case for a new global decision with the same `nonce`, and a case for a new decision on a server of a plugin.

## Steps

1. In `signatureOf`, add the plugin's `enablement` and `childEnablement`, serialized, to the URI and the `nonce`.
2. In `reconcile`, compute `signatureOf(before)` first, because `before` and `fresh` share each kept `HeldPlugin`.
3. When `samePlugin` finds the old `HeldPlugin`, compare its `enablement` and `childEnablement` with the new announcement.
4. Collect each kept plugin whose decisions differ, then set its `announced` to the new announcement.
5. Compare the saved signature of `before` with `signatureOf(fresh)`, and return when they match.
6. After the `session/customizationsChanged` dispatch, call `settle` for each collected plugin.
7. Keep `added` as it is: copy a plugin again only for a new URI or `nonce`.
8. Add the two test cases to `client-plugins-session.test.ts`, with a fresh subscriber reading the snapshot.

## Validation

- `client-plugins-session.test.ts`: a plugin announced with `{ kind: 'global', enabled: false }` and then `true`, with the same `nonce`, has `true` in a snapshot.
- `client-plugins-session.test.ts`: the second announcement brings one `session/customizationUpdated` for the plugin and no new copy request on the client's peer.
- `client-plugins-session.test.ts`: a new `childEnablement` for a server of a plugin is on that server in a snapshot.
- The case at line 345 still passes: the same announcement twice says nothing.
- `pnpm vitest run packages/sdk/test/client-plugins-session.test.ts` passes.

## Resume
