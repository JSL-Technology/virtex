#!/bin/sh
# Solo entorno local de QA: limpia los contadores del throttler de NestJS en Redis.
for k in $(redis-cli --scan --pattern '{*:default}:*'); do redis-cli del "$k" >/dev/null; done
for k in $(redis-cli --scan --pattern "step-up-attempts:*"); do redis-cli del "$k" >/dev/null; done
