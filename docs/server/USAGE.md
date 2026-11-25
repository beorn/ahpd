# Usage

See what each pool has spent.

```bash
ahpd usage                # the pools you may read
ahpd usage team:backend   # today, this week, this month
```

| Command | HTTP |
| --- | --- |
| `ahpd usage` | `GET /api/usage` |
| `ahpd usage <pool>` | `GET /api/usage/<pool>` |

Anyone may read their own `user:` pool and the `team:` and `project:` pools they belong to. Any other pool needs `usage:read`.

The days are cut in `usage.timezone`. The records and the pools are in [sdk/USAGE.md](../sdk/USAGE.md).

## Repair Claude costs

An older ahpd charged the first Claude turn after a session resumed the session's whole earlier cost again. To correct those records, run this from a checkout of ahpd:

```bash
node scripts/repair-claude-usage.mjs            # show what would change
node scripts/repair-claude-usage.mjs --write    # change it, with a copy of each file
```

Stop the daemon before `--write`, because it reads its totals only when it starts. The script needs the Claude transcripts in `~/.claude/projects`, and leaves a chat whose transcript is gone as it is. `--until <time>` limits it to records written up to that time. A second run changes nothing: a corrected record keeps its earlier cost in `meta['ahpd.repaired']`.
