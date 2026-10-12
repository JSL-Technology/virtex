#!/bin/bash
# Solo QA local: reinicia la API cuando queda colgada por el pool agotado.
echo "$(date -u +%T) RESTART API" >> /home/user/virtex/docs/qa/ux/harness/hangs.log
sudo -u postgres psql -d erp -tAc "select now(), pid, state, left(regexp_replace(query,'\s+',' ','g'),80) from pg_stat_activity where datname='erp' and state<>'idle' and pid<>pg_backend_pid()" >> /home/user/virtex/docs/qa/ux/harness/hangs.log
pkill -f "nx serve api" ; pkill -f "apps/backend/api" ; pkill -f "dist/apps/api"
sleep 2
sudo -u postgres psql -d erp -tAc "select pg_terminate_backend(pid) from pg_stat_activity where datname='erp' and pid<>pg_backend_pid()" >/dev/null
redis-cli --scan --pattern '{*:default}:*' | xargs -r redis-cli del >/dev/null
cd /home/user/virtex && DEV_SEED=true DEV_SEED_PASSWORD='QA-Test-Pass-2026' setsid nohup npx nx serve api > ${API_LOG:-/tmp/virtex-api.log} 2>&1 < /dev/null &
for i in $(seq 1 100); do curl -s -m 2 -o /dev/null -w '%{http_code}' localhost:3000/api/v1/auth/session 2>/dev/null | grep -q 200 && break; sleep 3; done
echo "$(date -u +%T) API UP" >> /home/user/virtex/docs/qa/ux/harness/hangs.log
