---
title: Plugin loading
status: current
covers:
  - packages/server/src/plugins.ts
  - packages/server/src/install.ts
  - packages/server/src/compat.ts
  - packages/server/src/commands/plugin.ts
  - packages/server/src/commands/scopes.ts
  - packages/server/src/agents/migrate.ts
decisions:
  - decisions/the-daemon-installs-its-own-sdk-beside-the-plugins.md
refs:
  - "[code://packages/server/src/plugins.ts#L82-L102](../../packages/server/src/plugins.ts#L82-L102) - `unimportedId`, `unscoped` and `provisionalOf`, the fallback id"
  - "[code://packages/server/src/plugins.ts#L166-L206](../../packages/server/src/plugins.ts#L166-L206) - `entryOf`, the order an entry is found in"
  - "[code://packages/server/src/plugins.ts#L223-L270](../../packages/server/src/plugins.ts#L223-L270) - `resolvePlugin`, which runs no plugin code"
  - "[code://packages/server/src/plugins.ts#L337-L372](../../packages/server/src/plugins.ts#L337-L372) - `checkManifest` and `checkShape`"
  - "[code://packages/server/src/plugins.ts#L500-L551](../../packages/server/src/plugins.ts#L500-L551) - `locate`, the sdk range check before import"
  - "[code://packages/server/src/plugins.ts#L718-L739](../../packages/server/src/plugins.ts#L718-L739) - `namePlugin`, the id from the `name` export"
  - "[code://packages/server/src/plugins.ts#L785-L792](../../packages/server/src/plugins.ts#L785-L792) - the slug check on the id"
  - "[code://packages/server/src/plugins.ts#L1112-L1131](../../packages/server/src/plugins.ts#L1112-L1131) - a repeated id, and a disabled entry"
  - "[code://packages/server/src/plugins.ts#L1231-L1299](../../packages/server/src/plugins.ts#L1231-L1299) - `describePlugin`, the row `ahpd plugin list` shows"
  - "[code://packages/server/src/install.ts#L496-L513](../../packages/server/src/install.ts#L496-L513) - `daemonsSdk`, the sdk at the daemon's version"
  - "[code://packages/server/src/install.ts#L554-L617](../../packages/server/src/install.ts#L554-L617) - `refuseNonPlugins` and `installPlugins`"
  - "[code://packages/server/src/install.ts#L665-L754](../../packages/server/src/install.ts#L665-L754) - `updatePlugins`, all or by name"
  - "[code://packages/server/src/install.ts#L777-L793](../../packages/server/src/install.ts#L777-L793) - `removePlugins`"
  - "[code://packages/server/src/commands/plugin.ts#L130-L200](../../packages/server/src/commands/plugin.ts#L130-L200) - the install, remove and update verbs"
  - "[code://packages/server/src/commands/scopes.ts#L16-L45](../../packages/server/src/commands/scopes.ts#L16-L45) - `checkScopes` and the deployment token refusal"
  - "[code://packages/server/src/commands/options.ts#L250-L375](../../packages/server/src/commands/options.ts#L250-L375) - how a `--plugin-option` path is split and set"
  - "[code://packages/server/src/rootconfig.ts#L247-L280](../../packages/server/src/rootconfig.ts#L247-L280) - the `plugins.<id>` keys in root config"
  - "[code://packages/server/src/rootconfig.ts#L320-L392](../../packages/server/src/rootconfig.ts#L320-L392) - a write to a plugin key"
  - "[code://packages/agent-claude/src/plugin.ts#L114-L146](../../packages/agent-claude/src/plugin.ts#L114-L146) - `kindOf` and `apply`, the `claude` kind one load registers"
  - "[code://packages/server/src/agents/migrate.ts#L345-L465](../../packages/server/src/agents/migrate.ts#L345-L465) - `planPresets`, a file's presets read as the records to write"
  - git://d9d4f950^ - the deleted decisions this spec was written from: a-plugin-loads-once-and-each-preset-is-a-variant, a-plugin-loads-the-daemons-sdk, a-plugin-option-is-given-by-repeating-plugin-option, a-plugin-uses-the-sdk-npm-installs-beside-it, a-plugins-id-is-its-modules-name, a-repeated-plugin-is-keyed-by-its-provider, installing-a-plugin-over-http-is-root-only, plugin-compat-is-checked-before-import, plugin-configuration-travels-in-root-config, plugin-install-also-names-the-plugin, plugin-manifest-is-package-json, plugin-packages-are-named-ahpd-name, plugin-update-takes-all-or-names, plugins-upgrade-through-their-own-command
---

The daemon reads the `plugins` list in its configuration, finds each plugin, checks it, imports it and applies it.
A first-party plugin is the npm package `@ahpd/<name>`, an agent backend is `@ahpd/agent-<name>`, and the plugin id is the `<name>`.
The manifest is the package's own `package.json`, with an `ahpd` field and a peer range on `@ahpd/sdk`.
The `ahpd plugin` verbs install, update, remove, enable, disable and configure plugins in the configuration directory, which is one npm project.
A problem with one plugin costs that plugin only, and the daemon starts with the rest.
The code is in [`code://packages/server/src/plugins.ts`](../../packages/server/src/plugins.ts) and [`code://packages/server/src/install.ts`](../../packages/server/src/install.ts).

## Scenarios

### The daemon finds a plugin

WHEN an entry in `plugins` is a bare package name
THEN the daemon resolves it from `AHPD_PLUGIN_ROOT/node_modules` first, then from the configuration directory
AND runs no plugin code while it resolves.

WHEN an entry is a path that is absolute or starts with `.`
THEN the daemon tries it against the working directory, then against the configuration directory.

WHEN an entry has a scheme such as `npm:`, `https:`, `data:` or `file:`
THEN the daemon passes it to the runtime as it is.

WHEN the daemon runs on Deno and an entry is a bare name
THEN the daemon refuses it and says to write `npm:<name>`.

### The daemon finds the entry of a package

WHEN a plugin is a package directory
THEN the entry is `ahpd.entry`, else `exports["."]` or its `default`, else `main`, else `index.js`
AND an entry outside the package, or a directory with none of these, is refused.

### The manifest is checked before import

WHEN the daemon reads a resolved package
THEN it refuses a `package.json` that does not parse or is not a JSON object
AND it refuses an `ahpd` field that is not an object, and an `ahpd.entry` that is not a string or points outside the package.

WHEN a plugin is a file
THEN the daemon checks the nearest `package.json` only if that file has an `ahpd` field.

WHEN the daemon resolved a package
AND the manifest entry and the resolved module are different files
THEN the daemon loads the manifest entry and reports the difference as a problem line.

### The sdk range is checked before import

WHEN a manifest has `peerDependencies["@ahpd/sdk"]`
THEN the daemon compares the range with its own sdk version before it imports the plugin
AND a range that does not admit the version is refused with "plugin X needs @ahpd/sdk R, this is V".

WHEN the range cannot be read
THEN the plugin is refused.

WHEN a manifest has no sdk peer
THEN the plugin loads.

The check is hand-written in [`code://packages/server/src/compat.ts`](../../packages/server/src/compat.ts), with no semver dependency.
The reason for the check before import: a plugin built for another sdk is refused with one sentence, and none of its code runs.

### A plugin has an id

WHEN a module exports `name`
THEN that string is the plugin id.

WHEN a module exports no `name`
THEN the id is the manifest name, else the file name, else the entry as written
AND a scoped name `@scope/name` becomes `scope-name`.

WHEN the id is not a slug of lowercase letters, digits and dashes, 1 to 40 long, that starts with a letter
THEN the plugin is skipped with a problem line.

WHEN the daemon refuses to load a package, such as one built for another sdk
THEN its id is the package name without its scope or its version: `@ahpd/agent-claude` is `agent-claude`
AND an entry that names no package, such as a path or a URL, is its own id.
The reason: the row keeps one id through the update that lets it load, in [decisions/a-refused-plugin-is-named-without-its-scope.md](../decisions/a-refused-plugin-is-named-without-its-scope.md).

A verb finds a plugin by its id or by its entry as written. A command over the protocol also takes a row's own id that holds a `/`.
This is so that a route, an owner and a root config key hold no `@` or `/`.

### A plugin loads once

WHEN two entries in `plugins` give the same id
THEN the first entry loads
AND each later one is a problem line that says to write the plugin once and use its options for variants.

WHEN an entry has `enabled: false`
THEN it is not loaded, but it still counts as a repeat of its id.

WHEN all entries are named
THEN the plugins apply in the order of the configuration.

The daemon imports and names every entry before any plugin applies.

### One load serves many agents

An agent is a record of a kind, made with `agent:put` or moved from a file's per-agent options at the first start.

WHEN a configuration file's entry for `@ahpd/agent-claude` or `@ahpd/agent-acp` holds `presets`
THEN the start writes each valid preset as a record of that kind, owned by `host`
AND takes it out of the file once the record holds it
AND a preset that was not written stays in the file.

WHEN the entry is `@ahpd/agent-claude` and holds `presets`
THEN the built-in `claude` record is written as well, unless `presets.claude` is `false`.

WHEN a claude entry holds no `presets`
THEN the first start writes the built-in `claude` record once.

WHEN a configuration file's entry for `@ahpd/agent-cofold` or `@ahpd/agent-pi` names `provider`
THEN the start writes one record of that kind, owned by `host`, with that id
AND takes `provider`, `displayName` and `description` out of the file once the record holds it.

A record that already holds the id is left as it is, and the preset for it is still taken out.

WHEN `@ahpd/agent-claude` loads
THEN it registers the agent kind `claude`
AND one load serves every record of that kind, each with its own id as its provider.

WHEN its options name `provider`, `displayName`, `models` or `keepCliModels` at the top level
THEN the loader reports each as an option the plugin does not know
AND the plugin loads: the first two are the channel's, and the last two are a record's `config`.

WHEN one record of the kind does not fit the kind's schema
THEN that record is written and shown as `invalid` with one line saying why
AND every other record of the kind serves.

`@ahpd/agent-acp` registers the kind `acp`, so one load serves many ACP servers.

### A plugin is installed

WHEN an operator runs `ahpd plugin install <name>...`
THEN the daemon runs one `npm install` in the plugin root, with `--legacy-peer-deps` and `@ahpd/sdk` at the daemon's version
AND adds each name to `plugins`, unless `--no-enable` is given.

WHEN a name has no version
THEN the daemon picks the newest version whose sdk range admits the daemon.

WHEN a registry package has no `ahpd` field
THEN the install is refused, because the package is not a plugin.

WHEN the name is a path or a URL, or is `@ahpd/sdk`
THEN the install is refused.

The plugin root is `AHPD_PLUGIN_ROOT`, or the configuration directory when that is unset.
This is so that the sdk in the plugin root is the daemon's own version, and one plugin's peer range never blocks another plugin.

### A plugin is updated

WHEN an operator runs `ahpd plugin update all`
THEN the daemon moves every registry install in one npm call
AND reports a moved sdk too.

WHEN an operator runs `ahpd plugin update <name>...`
THEN the daemon moves only those names
AND a name that is not installed is refused with "<package> is not installed in <root>."

WHEN `all` and names are given together
THEN the verb is refused with "Say which plugins to update: ahpd plugin update all, or ahpd plugin update <name>...".

WHEN `--force` is given
THEN the daemon makes one npm call for each package.

WHEN a plugin was installed from outside the registry
THEN the update leaves it as it is.

An update does not change the configuration file.
A plugin is upgraded through `ahpd plugin update`.

### A plugin is removed

WHEN an operator runs `ahpd plugin remove <name>...`
THEN the daemon takes the names out of `plugins` first, then uninstalls them, unless `--keep` is given
AND `@ahpd/sdk` stays installed.

WHEN `install`, `update` or `remove` gets no name
THEN the verb stops with exit code 2.

### A change waits for a restart

WHEN a plugin verb changes what is installed or configured
THEN it says "Restart the daemon to load the change: ahpd restart".

### A plugin verb over HTTP

WHEN a caller sends a plugin verb other than `list` over HTTP
AND the caller is not the deployment token
THEN the daemon refuses it with 403 and "<id> may not <what> here; only the deployment token may".

The verbs held to the deployment token are install, remove, update, enable, disable and the `config` verbs.
`list` needs `config:read`, and the command line is not checked.
The reason: these verbs change what code the daemon runs, so a role grant is not enough.

### Plugin options come from the configuration

WHEN a module exports `defaults`
THEN the options are the defaults with the entry's `options` laid over them.

WHEN a plugin exports `optionsSchema`
THEN the daemon resolves `$secret` references, then checks the options against the schema
AND an unknown key is passed through with a problem line.

WHEN an operator runs `ahpd plugin config set <plugin> <key> <value>`
THEN the value is read as JSON, or as text when it is not JSON, and checked against the schema.

WHEN the daemon answers a plugin's options over HTTP
THEN a write-only value shows as `<set>`.

### An option is given on the command line

WHEN the daemon starts with `--plugin-option PLUGIN.KEY=VALUE`
THEN that value is laid over the plugin's configured options for this run
AND the flag can repeat, and the key can be a deep path such as `PLUGIN.KEY.KEY`.

WHEN the value parses as JSON
THEN it is used as JSON, else as a string.

WHEN the plugin is not loaded and enabled, or the path runs into a value that is not an object
THEN the daemon refuses the flag
AND the refusal quotes the path and never the value.

### Plugin options in root config

WHEN a client reads root config
THEN each plugin is the key `plugins.<id>`, with the value `{ enabled, options }`
AND the schema is the plugin's `optionsSchema`, or an empty object for a plugin that did not load
AND a write-only value is masked.

WHEN a client writes a plugin key
THEN the options are merged, a `null` removes one option, and a `$secret` reference is checked by name
AND the answer says `restartNeeded`.

### The plugin list

WHEN an operator runs `ahpd plugin list`
THEN each plugin shows as ready, incompatible, unconfigured, disabled, missing or error
AND the list imports no plugin code.

WHEN a manifest marks an option in `ahpd.options` as required and the option has no value
THEN the plugin shows as unconfigured.
