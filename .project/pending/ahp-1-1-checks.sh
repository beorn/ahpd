#!/usr/bin/env bash
# Every check of ahp-1-1-checks.md in one run: it starts the test daemon, asks
# it, restarts it, asks again, and stops it.
#
#   bash ahp-1-1-checks.sh          all of it, with six short Claude turns
#   bash ahp-1-1-checks.sh free     the part with no model
set -u
for need in git node pnpm; do
  command -v "$need" >/dev/null || { echo "STOP  $need is not on the PATH."; exit 2; }
done
if [ "${1:-}" != free ] && [ ! -e "$HOME/.claude" ]; then echo "STOP  Claude is not signed in here: there is no ~/.claude."; exit 2; fi

echo "Setting up the test daemon, which can take some minutes the first time."
# shellcheck disable=SC1090
. <(git -C /github/ahpd fetch -q origin && git -C /github/ahpd show origin/main:.project/pending/test-daemon.sh) \
  agent-claude .project/pending/ahp-1-1-plugin/plugin.json || { echo "STOP  the test daemon did not start."; exit 2; }
trap 'ahpd stop' EXIT

checks="$AHPD_CHECK/.project/pending/ahp-1-1-checks.mjs"
failed=0
node "$checks" free || failed=1
if [ "${1:-}" != free ]; then
  node "$checks" claude || failed=1
  ahpd stop && ahpd start --port 39200 --connection-token-file "$AHPD_CHECK_HOME/token" || failed=1
  node "$checks" restart || failed=1
fi
echo
[ "$failed" = 0 ] && echo "RESULT: every check passed." || echo "RESULT: something failed. Look for the FAIL lines."
exit "$failed"
