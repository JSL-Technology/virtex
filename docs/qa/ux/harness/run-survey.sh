#!/bin/bash
# run-survey.sh <tag> <theme> <width> <filter> <lang>
H=/home/user/virtex/docs/qa/ux/harness
export START=1
rm -f $H/progress-$1
while true; do
  node $H/02-survey.cjs "$@"; rc=$?
  [ $rc -eq 0 ] && break
  START=$(cat $H/progress-$1 2>/dev/null || echo 1); export START
  $H/restart-api.sh < /dev/null > /dev/null 2>&1
done
echo DONE
