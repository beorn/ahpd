---
title: A computer's facts come in one shape
created: 2026-11-15
refs:
  - git://804a23937 - the commit of ahpd the facts were checked at
  - git://2653557a3 - the commit of ahpw the facts were checked at
  - git://fe15bff0c - the commit of ahpapp the facts were checked at
  - "[code://packages/computer/src/provider.ts#L187-L193](../../packages/computer/src/provider.ts#L187-L193) - the leaves of a machine: `status`, `capabilities`, `stats`, `state`"
  - "[code://packages/computer/src/catalogue.ts#L7-L17](../../packages/computer/src/catalogue.ts#L7-L17) - the channel record is `{ state, status }`, and `status` is the runtime's `inspect`"
  - "[code://packages/computer/src/runtime.ts#L577](../../packages/computer/src/runtime.ts#L577) - `inspect` answers a record with no fixed shape"
  - "[code://packages/computer/src/runtime.ts#L848-L869](../../packages/computer/src/runtime.ts#L848-L869) - `MachineStats`, the one shape every runtime already gives for `stats`"
  - "[code://packages/computer/src/vm.ts#L287-L296](../../packages/computer/src/vm.ts#L287-L296) - `recordFrom`: a VM answers a subset of Docker's shape"
  - "[code://packages/computer/src/vm.ts#L109-L121](../../packages/computer/src/vm.ts#L109-L121) - `VmMade`: a VM is made with `cpus` and `memory`, which no label keeps"
  - "[code://packages/computer/src/vm.ts#L148](../../packages/computer/src/vm.ts#L148) - `addressOn`, the hypervisor's answer for a VM's address"
  - "[code://packages/computer/src/libvirt.ts#L235-L236](../../packages/computer/src/libvirt.ts#L235-L236) - libvirt gets the CPUs and memory at create"
  - "[code://packages/computer/src/proxmox.ts#L292-L293](../../packages/computer/src/proxmox.ts#L292-L293) - proxmox gets the CPUs and memory at create"
  - "[code://packages/computer/src/ssh.ts#L69-L87](../../packages/computer/src/ssh.ts#L69-L87) - `SshMachine`, what an ssh box is configured with"
  - "[code://packages/computer/src/ssh.ts#L482-L490](../../packages/computer/src/ssh.ts#L482-L490) - `recordOf`: an ssh box answers its own shape, not Docker's"
  - "[code://packages/sdk/src/types/computers.ts#L303](../../packages/sdk/src/types/computers.ts#L303) - `ComputerPort`, where the SDK keeps the machine types"
  - https://github.com/ahpio/ahpw/blob/2653557a3/src/resources/computers/machines.ts#L90-L125 - ahpw reads Docker's field names out of `status`
  - https://github.com/ahpio/ahpapp/blob/fe15bff0c/src/computers.ts#L362-L397 - ahpapp reads the same field names
  - file:///github/ahpd/.project/briefs/a-computer-kind-comes-from-any-plugin.md - the brief that moves each runtime to a kind
---

# A computer's facts come in one shape

The goal is one computer page in ahpw that shows the same sections for every kind of computer.
Softov wants the page to show more of what a machine is: its process and resources, network, mounts, security and AHP metadata.
Today each runtime answers its own record, and each client reads Docker's field names out of it.
With two or three kinds at once, each client needs one reader for each kind.
ahpd should send one typed shape, and each client should lay it out and label it.

## What others do

Docker's `docker inspect` is the source of most of the facts.
The VM runtimes copy part of its shape, as *What ahpd has today* shows.

## What ahpd has today

What a client reads:

- A machine has four leaves: `status`, `capabilities`, `stats` and `state` ([`code://packages/computer/src/provider.ts`](../../packages/computer/src/provider.ts#L187-L193)).
- The `x-ahpd-computers://` record is `{ state, status }`, and `status` is the runtime's `inspect` ([`code://packages/computer/src/catalogue.ts`](../../packages/computer/src/catalogue.ts#L7-L17)).
- `inspect` answers a record with no fixed shape ([`code://packages/computer/src/runtime.ts`](../../packages/computer/src/runtime.ts#L577)).
- `stats` already has one shape for every runtime, `MachineStats` ([`code://packages/computer/src/runtime.ts`](../../packages/computer/src/runtime.ts#L848-L869)).

What each runtime puts in `status`:

| Fact | Docker | VM: libvirt, proxmox | ssh |
| --- | --- | --- | --- |
| Shape | Docker's own | A subset of Docker's ([`code://packages/computer/src/vm.ts`](../../packages/computer/src/vm.ts#L287-L296)) | Its own ([`code://packages/computer/src/ssh.ts`](../../packages/computer/src/ssh.ts#L482-L490)) |
| Image | `Config.Image` | `Config.Image`, from a label | None |
| Working folder | `Config.WorkingDir` | `Config.WorkingDir`, from a label | `workdir` |
| State word | `State.Status` | `State.Status`, the hypervisor's word | None |
| Command | `Config.Entrypoint`, `Config.Cmd` | None | `host`, the command that starts its ahpd |
| CPUs, memory | `HostConfig.NanoCpus`, `Memory`, `MemorySwap` | None | None |
| Process, restarts, times | `State.Pid`, `RestartCount`, `Created`, `State.StartedAt` | None | None |
| Network | `HostConfig.NetworkMode`, `NetworkSettings`, `HostConfig.ExtraHosts` | None | `destination`, `port`, `identity` |
| Mounts | `Mounts`, with `Type`, `Name`, `Source`, `Destination`, `RW` | None | None |
| Security | `HostConfig.Privileged`, `RestartPolicy`, `ReadonlyRootfs`, `State.OOMKilled`, `AppArmorProfile`, `HostConfig.Runtime` | None | None |
| AHP metadata | `Config.Labels`, the `ahpd.*` keys | `Config.Labels`, the same keys | `agents` |
| Platform | `Platform`, `Driver` | None | None |

What a VM lacks:

- A VM is made with `cpus` and `memory` ([`code://packages/computer/src/vm.ts`](../../packages/computer/src/vm.ts#L109-L121)).
- libvirt and proxmox get both at create ([`code://packages/computer/src/libvirt.ts`](../../packages/computer/src/libvirt.ts#L235-L236), [`code://packages/computer/src/proxmox.ts`](../../packages/computer/src/proxmox.ts#L292-L293)).
- No label keeps them, so a later read cannot tell them.
- `addressOn` asks the hypervisor for a VM's address ([`code://packages/computer/src/vm.ts`](../../packages/computer/src/vm.ts#L148)). The record does not hold it.

What the clients do:

- ahpw reads Docker's field names out of `status` ([machines.ts](https://github.com/ahpio/ahpw/blob/2653557a3/src/resources/computers/machines.ts#L90-L125)).
- ahpapp reads the same field names ([computers.ts](https://github.com/ahpio/ahpapp/blob/fe15bff0c/src/computers.ts#L362-L397)).
- An ssh box shows only its destination and working folder in ahpw, because its record has none of Docker's fields.

## Who writes

| Writer | Files | What the change does to it |
| --- | --- | --- |
| [a-computer-kind-comes-from-any-plugin.md](a-computer-kind-comes-from-any-plugin.md) | `packages/computer/src/runtime.ts`, the SDK | Each runtime becomes a kind. `facts` becomes one more handler that a kind gives |
| `container/20261030-1141-a-vm-is-made-on-a-server`, active | `packages/computer/src/provider.ts`, `runtime.ts` | It makes VMs. Not checked: whether it changes how a VM's labels are written |
| `container/20261112-0821-a-git-seed-takes-three-execs`, planned | `packages/computer/src/runtime.ts`, `vm.ts` | It changes `vm.ts`. Not checked: whether it touches `recordFrom` or the labels |
| `container/20261112-0821-a-machine-says-how-it-reaches-the-host`, planned | `packages/computer/src/runtime.ts`, `packages/sdk/src/types/computers.ts` | Both add to the SDK computer types. Not checked: whether its field overlaps `network` |
| Seven other open plans | `packages/computer/src/runtime.ts` or `packages/sdk/src/types/computers.ts` | They name the files for other work. Not checked: each one's lines |
| ahpw | `src/resources/computers/machines.ts`, `Page.tsx` | It reads the `facts` leaf, and draws and labels its sections |
| ahpapp | `src/computers.ts` | The same change as ahpw |
| MayCXC's fork | No branch ahead of main touches these files | No overlap |

## The change

The SDK types the facts:

- `ComputerFacts` goes in `packages/sdk/src/types/computers.ts`, beside `ComputerPort`, so that ahpw and ahpapp import it.
- Each field is optional. An absent field is a fact the kind does not know, and a client hides it.
- Sizes are bytes, times are ISO 8601, and CPUs are a count of cores.

The fields, in the groups that the ahpw page shows:

| Group | Fields |
| --- | --- |
| The machine | `kind` (`docker`, `libvirt`, `proxmox`, `ssh`), `running`, `word` (the runtime's own state word), `created`, `started`, `exitCode`, `oomKilled` |
| Process and resources | `image`, `command`, `workdir`, `pid`, `containerId`, `restarts`, `cpus`, `memory`, `memorySwap` |
| Network | `mode`, `addresses` (each an address and a prefix length), `gateway`, `mac`, `ports`, `extraHosts` |
| Connection | `destination`, `port`, `identity` |
| Mounts | A list, each with `type`, `source`, `target` and `readOnly` |
| Security and lifecycle | `privileged`, `readOnlyRoot`, `restartPolicy`, `appArmor`, `runtime` |
| AHP metadata | `labels`, the `ahpd.*` keys and their values |
| Platform | `platform`, `storage` |

ahpd serves the facts:

- A machine gets a fifth leaf, `computer://<id>/facts`, which answers `ComputerFacts` as JSON.
- Each runtime gives a `facts` handler. It maps its own record to the shape.
- The channel record and the `status` leaf stay as they are. A client keeps showing the runtime's own record, folded.
- A client reads the leaf when the page opens, and again when the channel says the machine changed.

A VM tells more:

- A VM's create writes its CPUs and memory as two labels, beside its other `ahpd.*` labels.
- Its `facts` reads both labels, and asks `addressOn` for its address.
- The address costs one reach of the hypervisor, and only a read of the `facts` leaf pays it.

The clients draw the facts:

- ahpw reads the leaf in place of Docker's field names, and gives each group a section with a title and an icon.
- ahpw labels and translates each field with its own catalog.
- ahpapp makes the same change.

## Answers

| What | Source |
| --- | --- |
| ahpd sends typed fields, and each client lays them out and labels them | Softov, 2026-11-15: "ahpd sends typed fields" |
| The facts are a leaf, `computer://<id>/facts`, read when the page opens | Softov, 2026-11-15: "A computer://<id>/facts leaf" |
| A VM adds its CPUs, memory and address to its facts | Softov, 2026-11-15: "Add VM CPUs, memory, address" |
| The ahpw page follows the mockup with one section for each group, an icon on each title, and no numbers | Softov, 2026-11-15: "mk0 is the best" |
| The channel record and the `status` leaf stay | (defaulted: a client shows the runtime's own record, folded) |
| The type goes in the SDK beside `ComputerPort` | (defaulted: the SDK keeps the machine types that a client imports) |
