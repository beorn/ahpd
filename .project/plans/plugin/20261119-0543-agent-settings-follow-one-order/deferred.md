---
title: Agent settings follow one order - deferred
date: 2026-11-19
---

Softov closed the plan on 2026-11-19 before its checks by hand: "#385 can be considered closed also for now".
These checks wait for the working day on main, which Softov does in ahpw and ahpd for 0.15.0.

- In ahpw, each agent plugin's options and each agent's form list the fields of *Field order*, in that order.
- A Claude agent with no `model` starts on the plugin's `model`.
- An acp agent on a machine that cannot start shows the short sentence, and the log holds the raw message.

A fault in one of them is a problem file.
