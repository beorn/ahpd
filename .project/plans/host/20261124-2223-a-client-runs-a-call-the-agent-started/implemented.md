---
title: A client runs a call only when the agent started it, as built
---

## What exists

- Claude: a client's call stays `streaming` until its handler runs or the person allows it.
- ACP: a client's call stays `streaming` until its `tools/call` arrives or the person allows it. An allowed call that the client answers before the request is still found, so it runs once.

## Verified

- A client that answers at once, with a question and with none, on a call reported whole and on one streamed.
- The new cases fail on the code before the change.
- The typecheck and the whole suite.
- A real Claude session in "Ask Before Edits", with ahpw's tools. Each call asked before it ran, an allowed call ran once, a denied call never reached ahpw, and the agent replied. A script gave the answers over the protocol.
- Not verified live: a Claude session that asks no question, and a real ACP agent.

## Departures from the plan

- The plan readied a call that ends with no handler before its completion. A test showed that the host then offers the call to its client. The call is left `streaming` until its turn ends.
- The row of such a call does not show the agent's reason.
