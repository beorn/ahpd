---
title: Automations
status: current
covers:
  - packages/sdk/src/automations/automations.ts
  - packages/sdk/src/host/automations.ts
  - packages/sdk/src/types/automations.ts
  - packages/sdk/src/types/triggers.ts
  - packages/sdk/src/automations/triggers.ts
  - packages/sdk/src/automations/wakemessage.ts
  - packages/server/src/scheduled.ts
refs:
  - "[code://packages/sdk/src/types/automations.ts#L216-L365](../../packages/sdk/src/types/automations.ts#L216-L365) - `AutomationStore`, the port"
  - "[code://packages/sdk/src/automations/automations.ts#L264-L293](../../packages/sdk/src/automations/automations.ts#L264-L293) - `checkTriggers` and `checkWake`, the checks at write"
  - "[code://packages/sdk/src/automations/automations.ts#L396](../../packages/sdk/src/automations/automations.ts#L396) - `memoryAutomations`, the store in memory"
  - "[code://packages/sdk/src/types/triggers.ts#L106-L156](../../packages/sdk/src/types/triggers.ts#L106-L156) - `SessionRule` and `AutomationWake`"
  - "[code://packages/sdk/src/automations/wakemessage.ts#L39](../../packages/sdk/src/automations/wakemessage.ts#L39) - `WAKE_PLACEHOLDERS`"
  - "[code://packages/sdk/src/automations/wakemessage.ts#L73-L104](../../packages/sdk/src/automations/wakemessage.ts#L73-L104) - the summary block and `wakeMessage`"
  - "[code://packages/sdk/src/host/automations.ts#L106-L114](../../packages/sdk/src/host/automations.ts#L106-L114) - `wakeOf`, the waking settings in `_meta.ahpd`"
  - "[code://packages/sdk/src/host/automations.ts#L240-L268](../../packages/sdk/src/host/automations.ts#L240-L268) - `stillGoing` and `settleRun`"
  - "[code://packages/sdk/src/host/automations.ts#L493-L584](../../packages/sdk/src/host/automations.ts#L493-L584) - `hold`, `skip` and `request`, what an overlapping event does"
  - "[code://packages/sdk/src/host/automations.ts#L783-L881](../../packages/sdk/src/host/automations.ts#L783-L881) - `beginAutomation`, a pinned run as a turn in one chat"
  - "[code://packages/sdk/src/host/automations.ts#L1100-L1108](../../packages/sdk/src/host/automations.ts#L1100-L1108) - `counted`, the cap of 20 event wakes an hour"
  - "[code://packages/sdk/src/host/actions.ts#L839-L847](../../packages/sdk/src/host/actions.ts#L839-L847) - `withPinOf`, which keeps the pinned chat out of a client's hands"
  - "[code://packages/server/src/scheduled.ts#L196-L221](../../packages/server/src/scheduled.ts#L196-L221) - `textOf`, an automation as a Markdown file"
  - "[code://packages/server/src/scheduled.ts#L526-L580](../../packages/server/src/scheduled.ts#L526-L580) - `fire` and `catchUp`"
  - "[code://packages/server/src/scheduled.ts#L702-L797](../../packages/server/src/scheduled.ts#L702-L797) - `reread` and the watch on the folder"
  - "[code://packages/server/src/scheduled.ts#L919-L981](../../packages/server/src/scheduled.ts#L919-L981) - `migrateAutomations`, the split of `automations.json`"
  - "[code://packages/server/src/config.ts#L105-L112](../../packages/server/src/config.ts#L105-L112) - the `automations` option"
  - git://d9d4f950^ - the deleted decisions this spec was written from: a-person-edits-a-record-as-a-markdown-file, a-pinned-automation-runs-as-turns-in-one-chat, a-run-is-told-what-woke-it, a-trigger-rule-has-a-fixed-shape, an-automation-run-state-is-kept-apart, an-automation-says-what-an-overlapping-event-does, automation-run-settles-when-its-sessions-stop, the-automation-store-lives-in-server, the-daemon-reloads-a-hand-edited-file
---

An automation is a message that the host sends to an agent on a schedule, on an event, or when a person presses Run.
Each start is a run, and a run is a session of its own or the next turn in one pinned chat.
The port `AutomationStore` is in the sdk, with `memoryAutomations` for a daemon that keeps no files.
The daemon's store `scheduledAutomations` is in [`code://packages/server/src/scheduled.ts`](../../packages/server/src/scheduled.ts), and it has the clock and the files.
The store does not start sessions: it says that an automation is due, and the host starts the run.
The reason: only the host knows what a session is, so an automation fires with no client connected.

## Scenarios

### An automation is a Markdown file

WHEN the daemon saves an automation
THEN it writes `<configDir>/automations/<id>.md`, with the fields as YAML frontmatter and `message.text` as the body
AND the id is a lowercase slug of at most 64 characters, and the file name is the id
AND the file is written at mode `0600` through a temporary file and a rename.
A copy of a file under a new name is a new automation.

### Run state is kept apart from the file

WHEN a run changes `runCount`, `nextRunAt`, `modifiedAt` or the copies of client plugins
THEN the daemon writes them to `<configDir>/automations-state.json`, not to the automation file
AND a row whose automation file is gone is dropped at the next save.
This is so that a run does not rewrite the file a person edits.
A copied file has no row, so it starts with no runs used.

### A hand edit is read again

WHEN a person edits, adds or removes an automation file while the daemon runs
THEN the daemon reads the file again after its events stop for 50 ms
AND the definition in the file replaces the whole definition in the store, so a removed line clears that field
AND a removed file removes the automation.
The store ignores the events of its own writes.

### A file the host refuses

WHEN an automation file holds a definition that the host refuses
THEN the daemon reports the file and the reason
AND at start it skips the file, and on a hand edit it keeps the definition it had.

### The old single file

WHEN the daemon starts and finds `automations.json` and an empty automation folder
THEN it writes one file for each automation and the run state of all of them
AND renames the old file to `automations.json.migrated`.

### A daemon that keeps no files

WHEN the daemon config sets `automations` to `memory`
THEN the definitions last only for the life of the process, and no schedule fires
AND `file` is the default.

### Every automation due at once fires

WHEN two or more automations are due at the same moment
THEN the store takes all of them before it announces any of them
AND each one fires.

### A missed schedule

WHEN the daemon starts after an occurrence went by while it was not running
THEN it starts one catch-up run, however many occurrences went by
AND a trigger with the misfire policy `skip` gets no catch-up, and an `afterDate` that went by gets none.
Run history does not survive a restart, because the sessions of a run go with the daemon.

### A rule has a fixed shape

WHEN an automation wakes on a session event
THEN its rule names one of eight event kinds, such as `turnCompleted`, `toolFailed` or `idle`
AND it can add a `filter` on sessions, a `count` over a window, a `then` part, and `when` checks on the session.
A `then` part is a later event, a quiet period, or an event that does not come.
The reason: a client can draw every rule as a form.

### A bad rule is refused at write

WHEN a client writes a trigger whose config or event this host does not accept
THEN the store refuses the write
AND a trigger of a type that no plugin registered yet is kept, and does not fire.

### A run is told what woke it

WHEN an event wakes a run
THEN the host fills `{{session}}`, `{{sessionTitle}}`, `{{event}}`, `{{count}}`, `{{trigger}}`, `{{at}}` and `{{event.<field>}}` in the message
AND the message ends with a block that names the event, the session and its title, the count and the time.
A placeholder not in that list stays as written, and a message with no placeholders works as it is.

### What an overlapping event does

WHEN an event arrives while a run of the same automation is still going
THEN `queue`, the default, holds one waiting run and adds the new count to it
AND `steer` puts the message into the running turn, and holds the event when that turn cannot take it
AND `parallel` starts one run for each event
AND `skip` drops the event and adds one to `ahpd.dropped` in the notes of the run that is going.

### At most 20 event wakes an hour

WHEN an event wakes an automation for the 21st time in one hour
THEN the host drops the wake and writes a log line
AND a schedule or a press of Run does not count against the cap.
A dropped `skip` event is not counted, because it did not start a run.

WHEN a plugin asks for a run by an automation's id, as the webhook connector does
THEN the run counts against the cap as an event's wake
AND it obeys the automation's overlap mode.

### A pinned automation runs in one chat

WHEN an automation sets `_meta.ahpd.session` to `pinned`
THEN its first run makes a session and the host writes it to `_meta.ahpd.pinnedSession`
AND each later run is a new turn in that chat, which the host wakes when it is asleep
AND a run makes a new pinned session when the old one is gone.
A client cannot write `pinnedSession`, because the host keeps the stored value in its place.

### A pinned run that cannot start

WHEN a pinned run starts
AND the chat belongs to somebody else, or the chat is running a turn
THEN the host refuses the run with -32009
AND a write that sets `pinned` with the overlap `parallel` is refused, because one chat runs one turn at a time.

### Who a run is

WHEN a run starts for a `user:` owner
THEN the owner has to have signed in once and to hold `session:read`
AND the host asks the same admission checks that a session made by that person gets.
A rule of an automation with no owner sees every session, unless the daemon sets `unownedAutomations` to `none`.

### A run settles when its sessions stop

WHEN the turn of a run ends as completed, cancelled or failed
AND no other session of the run is in progress or waiting for input
THEN the store moves the run to that end state
AND the waiting run of that automation starts on the next turn of the event loop.
A disposed session settles its run as cancelled, and a late ending does not reopen a run that has ended.

### A run is marked running before its session starts

WHEN the store starts a run
THEN it marks the run running before it asks for the session
AND a session that fails to start marks the run failed with the reason.
The reason: a fast backend can end the turn before the start call returns.

### Run history

WHEN an automation has more than 50 runs that have ended
THEN the store keeps the newest 50 of them
AND it keeps every run that has not ended.
