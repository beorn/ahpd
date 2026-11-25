---
title: A model names its vendor
status: done
depends: [01]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/root.ts#L300-L316](../../../../packages/sdk/src/host/root.ts#L300-L316) - `descriptors`, which spreads each model, so a `vendor` passes through"
  - "[code://packages/sdk/src/host/catalogue.ts#L1148-L1160](../../../../packages/sdk/src/host/catalogue.ts#L1148-L1160) - `setAgentModels`, which compares the lists with `isDeepStrictEqual`"
---

## Objective

A test shows that a `vendor` a backend puts on a model reaches the client, and that a changed vendor counts as a changed list.
The code already does both, so the task changes no source unless the test fails.

## Files

- `UPDATE: packages/sdk/test/host-catalogue.test.ts` - the vendor cases.

## Steps

1. Add a case: a backend's model with `vendor` reaches `root` state with the same `vendor`.
2. Add a case: a backend that changes only a model's `vendor` dispatches `root/agentsChanged`.
3. Keep each backend's `models()` as it is, since no backend fills `vendor` yet.

## Validation

- `packages/sdk/test/host-catalogue.test.ts` - both cases pass, and an equal list dispatches nothing.
- The sdk vitest suite passes.

## Resume

The code already passes a model's `vendor` through, since `descriptors` spreads each model, and `setAgentModels` compares with `isDeepStrictEqual`. A case in `host-harness.test.ts`, beside the model list case, shows both. The vendor reaches `root/agentsChanged`, and a change of the vendor alone says the list again. No source changed.
