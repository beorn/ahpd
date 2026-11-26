---
title: A thing has an id and a tree of values
created: 2026-11-25
refs:
  - "[ideas/a-plugin-registers-a-thing-and-its-kinds.md](a-plugin-registers-a-thing-and-its-kinds.md) - the earlier meaning of a thing, now a list"
  - https://www.broadband-forum.org/technical/download/TR-069.pdf - TR-069, where an ACS manages each device as a tree of named parameters (not fetched for this idea)
---

Softov, 2026-11-25: "registerThing is suppose to be something else. Like a device on ACS, or a ioT thing. Or just something that has a ID and a tree key value with some information."

A thing is one device or object with an id.
A tree of keys and values says what it is and how it is now.
A device that an ACS manages, or an IoT device, is a thing.
`registerThing` would register such a thing, and is not the list that `registerList` registers.
Nothing more is decided.
