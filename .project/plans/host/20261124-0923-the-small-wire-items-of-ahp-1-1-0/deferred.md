---
title: The small wire items of AHP 1.1.0 - deferred
date: 2026-11-24
---

## `resultMetadata` after a restart

A client's tool result keeps `resultMetadata` while the host runs. A restart rebuilds a chat from its agent's own transcript, which never had the MCP `_meta`, so the field is gone. VS Code's host keeps it in its own database, for a restored MCP App card. To keep it, ahpd would store a client's tool results beside the transcript. It goes in a plan of its own when Softov asks for it.
