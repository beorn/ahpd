# Patches this fork carries over upstream

Seeded 2026-11-24 from #38158 (@dev/6, per @cto 193269b5 / b443133f). @dev/1's rebase completes it.

This list measures the operator's "zero patches" target. Each line is one patch carried on
`hh/integration` over `upstream/main` (ahpio/ahpd):
commit · what · why (issue) · upstream status.
Upstream status is one of: `PR pending card` (text ready, posted only on the operator's
upstream card), `posted <url>`, `not upstreamable: <reason>`, or `unknown` (not yet checked).
Rows are the patches named so far, from `git log upstream/main..hh/integration`. They are not
yet complete: about 71 commits sit over upstream, and many are tests or work-in-progress
steps of one patch.

- `11f66c758` · a session's change baseline is an unreferenced tree held in memory, with no per-turn refs; no baseline reads unknown, never 0. It replaces the removal in `d17130bbf` · #38158 · PR pending card (/hh/var/@dev6/38158-upstream-pr.md)
- `c6f74e9d0` · agent-acp marks and reports turns the agent starts itself; an update outside every turn is counted and warned, never dropped silently · #38159 · PR pending card (beorn fix/updates-outside-a-turn)
- `adcbeece7` · agent-acp lists each record's own folder, so a same-account thread is not credited to another record · unknown · unknown
- `64ddcd26b`, `dec3c1424` · agent-acp uses one bounded backoff for a host server that dies before initialize · #37753 · unknown
- `26303059d` · sdk: a throwing close still releases the session folder · #37472 · unknown
- `2dae899b5` · sdk: an unlist drops the row and keeps the provider conversation · #37603 · unknown
- `e6ed9944d`, `e1b7097f2`, `8c1632147`, `9f1716148` · sleep: name a failed sleep; sleep never-spoken or archived chats · #37577, #37426 · unknown
- `861b34309` · agent-acp passes the server's opening `_meta` through on the session state · #37272 · unknown
- `3c0500e36` · host and agents stamp turnId on chatInput requests and fence the post-abort unwind · #35154 · unknown
- `e9a357c66`, `accd216d6`, `109fb842c`, `11d020247` · agent-acp keeps a host-owned custody record through the child's end, under one per-seat lock · #34599 · unknown
- `f3f3f3937`, `ab933f119` · sdk re-derives the inhab JSONL append source from Ag · 35067 · not upstreamable: hh-specific inhab format (to confirm)
