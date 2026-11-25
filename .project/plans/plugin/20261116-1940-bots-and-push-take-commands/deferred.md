---
title: What bots and push devices take commands leaves
---

- **Removing the resource paths.** `resourceRead`, `resourceWrite` and `resourceDelete` on `bot://` and `push://` stay through 0.15. Softov chose on 2026-11-24 for 0.16: "Remove writes and deletes". Reads stay, since ahpapp lists bots with them and ahpw reads the push key. A plan of its own removes `resourceWrite` and `resourceDelete`.
