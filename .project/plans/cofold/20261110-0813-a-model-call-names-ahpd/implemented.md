---
title: A cofold model call names ahpd - implemented
date: 2026-11-10
refs:
  - git://41a1944f9
  - "[code://packages/agent-cofold/src/plugin.ts](../../../../packages/agent-cofold/src/plugin.ts) - the `app` a model call names"
---

Every cofold model call says it comes from ahpd, so OpenRouter puts the usage under ahpd. PR #274 merged it on 2026-11-10.

## What was built

- [`code://packages/agent-cofold/src/plugin.ts`](../../../../packages/agent-cofold/src/plugin.ts) - passes `app: { name: 'ahpd', version, url: 'https://ahpio.com' }`, from which `@cofold/model-openai-compat` sends `User-Agent: ahpd/<version>`, and to OpenRouter `HTTP-Referer: https://ahpio.com` and `X-OpenRouter-Title: ahpd`. A provider's own headers in the harness file still win.
- [`code://packages/agent-cofold/package.json`](../../../../packages/agent-cofold/package.json) - `@cofold/model-openai-compat` `^0.3.0`, the first version with the app option.

## Verified

- The agent-cofold model cases. CI passed on #274.

## Departures from the plan

- None recorded.

## Left for later

- None.
