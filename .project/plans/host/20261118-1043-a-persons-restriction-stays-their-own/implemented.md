---
title: A person's restriction and answer stay their own - implemented
date: 2026-11-18
refs:
  - git://49003faac - the merge of #377
---

On a host with users, the auto-approve restriction a person's window pushes holds in that person's sessions, and no other person's push lifts it.
A client's answer to a question is never recorded as the host's own policy.

## What was built

- [01 - The auto-approve restriction is a person's own](task-01-the-restriction-is-a-persons-own.md).
- [02 - A client's answer is never the host's policy](task-02-an-answer-is-never-the-hosts-policy.md).

## Verified

- CI on #377 passed every check, Windows included, and it merged as `49003faac` on 2026-11-18.
- Each task file says what its cases check.
- The check by hand on the test daemon passed on 2026-11-18. The restriction alice pushed held after carol pushed `false`, and carol's own session ran with no question.

## Departures from the plan

- Beyond task 01, the Allow All refusal in `chatactions.ts` and the policy a session starts with also read the owner's value, through `approvalSetting`.

## Left for later

- none
