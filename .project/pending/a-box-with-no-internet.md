---
title: A box with no internet
---

# A box with no internet

Plan [container/20261125-0131](../plans/container/20261125-0131-a-box-with-no-internet-gets-a-copy/plan.md) was checked with a stand-in for ssh. This is the check over a real ssh, with a session.
Take a Linux box that is in the `ssh` option of the computer plugin, names no `host`, and has `python3`, `make` and `g++`.

1. On the box, remove its installs: `rm -rf ~/.local/share/ahpd/server`.
2. On the box, send nodejs.org and npm nowhere: `echo '127.0.0.9 nodejs.org registry.npmjs.org' | sudo tee -a /etc/hosts`.
3. Start a cofold session on the box and send a prompt.
   Pass: the daemon's log says `this host sends it the files`, then `was installed on`, and the prompt is answered. Fail: the session is refused.
4. Run a terminal in that session. Pass: it opens. Fail: it says there is no terminal support.
5. On the box, run `ls -A ~/.local/share/ahpd/server`. Pass: one folder. Fail: a folder that starts with `.copy`.
6. Remove the line of step 2 from `/etc/hosts`.
