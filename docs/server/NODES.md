# Nodes

Run sessions on another machine that joins this host. The other machine is a **node**, and this host is its **hub**. The node dials out to the hub, so no port is opened on it, and a box behind NAT can join.

```bash
# on the hub: add the node and mint its token, shown once
ahpd node add box

# on the box: join the hub and keep the connection
ahpd join ws://hub.example:9187 --token <token> --workdir /srv/box
```

A client lists `node.box` while the node is connected, and a session made with `computer: "computer://node.box"` runs there.

| Command | Does |
| --- | --- |
| `ahpd join <url>` | Join a hub at a `ws://` or `http://` address and keep the connection, joining again with a backoff of up to a minute when it drops. Ctrl-C leaves |
| `ahpd node list` | Show the nodes in the file |
| `ahpd node add <id>` | Add a node and mint its token, shown once. Adding it again replaces the token, and the old one stops working |
| `ahpd node rm <id>` | Take a node out. A running hub drops it at once, with every session it runs |

## On the node

`ahpd join` takes the token from `--token`, `--token-file` or `AHPD_TOKEN`. `--workdir` names the folder a session on the node starts in, and the current folder is the default.

## On the hub

The nodes are kept in a nodes file beside the users file, so `--users` or the `users` key names both. A host with no users file has nowhere to keep a node. Only the token's hash is kept.

With no `--users` and no `--config-file`, `node add` and `node rm` at the hub's terminal go to the running daemon, as `ahpd paths` does. So a removed node, or one whose token was replaced, is dropped at once. With no daemon answering, they write the file, and the token is refused from the node's next connection on. A daemon that runs without the [HTTP API](REMOTE.md#http-api) keeps a joined node until it restarts, and the command says so.

| Grant | Lets a person |
| --- | --- |
| `node:read` | List the nodes |
| `node:write` | Add and remove them |

## More

- [Joined nodes](../plugins/COMPUTERS.md#joined-nodes): what runs on a node, what it trusts the hub with, its version, and a restart of either side, with `nodeRestart`.
- [Reference](REFERENCE.md): every flag of these commands.
