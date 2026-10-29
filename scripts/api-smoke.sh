#!/usr/bin/env bash
# Walks the Dispatchlet REST API with a real token (SPEC §44.3). Read routes always run; routes
# that change something run only with --write, and clean up what they make. Dry runs only.
#
#   scripts/api-smoke.sh <base-url> <token> [--write]
#   scripts/api-smoke.sh https://polite-marlin-194.convex.site/v1 dl_… --write
#   scripts/api-smoke.sh https://dispatchlet.com/api/v1 dl_…
set -euo pipefail
BASE=${1:?base URL, such as https://dispatchlet.com/api/v1}
TOKEN=${2:?a dl_ token}
WRITE=${3:-}
pass=0
fail=0

check() { # name, expected status (or a|b), method, path, [body]
  local name=$1 want=$2 method=$3 path=$4 body=${5:-}
  local out status
  if [[ -n $body ]]; then
    out=$(curl -s -w '\n%{http_code}' -X "$method" "$BASE$path" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$body")
  else
    out=$(curl -s -w '\n%{http_code}' -X "$method" "$BASE$path" -H "Authorization: Bearer $TOKEN")
  fi
  status=${out##*$'\n'}
  BODY=${out%$'\n'*}
  if [[ "|$want|" == *"|$status|"* ]]; then
    pass=$((pass + 1)); printf '  ok   %-44s %s\n' "$name" "$status"
  else
    fail=$((fail + 1)); printf '  FAIL %-44s %s (wanted %s) %s\n' "$name" "$status" "$want" "${BODY:0:160}"
  fi
}
field() { python3 -c "import sys,json; d=json.load(sys.stdin); print(eval('d' + sys.argv[1]))" "$1" <<<"$BODY"; }

echo "Read routes"
check 'GET /openapi.json (no token)' 200 GET /openapi.json
check 'GET /me' 200 GET /me
check 'GET /channels' 200 GET /channels
check 'GET /automations' 200 GET /automations
AUTOMATION=$(field "['automations'][0]['_id']" 2>/dev/null || true)
if [[ -n $AUTOMATION ]]; then
  check 'GET /automations/:id' 200 GET "/automations/$AUTOMATION"
  check 'GET /automations/:id/playbook' 200 GET "/automations/$AUTOMATION/playbook"
  check 'GET /automations/:id/runs' 200 GET "/automations/$AUTOMATION/runs?limit=3"
  RUN=$(field "['runs'][0]['_id']" 2>/dev/null || true)
  [[ -n $RUN ]] && check 'GET /runs/:id' 200 GET "/runs/$RUN"
fi
check 'GET /posts?status=draft' 200 GET '/posts?status=draft&limit=5'
check 'GET /webhooks' 200 GET /webhooks
check 'GET /hooks' 200 GET /hooks
check 'GET /posts?status=nope is 400' 400 GET '/posts?status=nope'
check 'GET /automations/bad id is 404' 404 GET /automations/notanid
check 'GET /nothing is 404' 404 GET /nothing

if [[ $WRITE == --write ]]; then
  echo "Write routes (cleaned up afterwards)"
  check 'POST /webhooks bad URL is 400' 400 POST /webhooks '{"url":"https://10.0.0.1/x","events":["ping"]}'
  check 'POST /webhooks' 201 POST /webhooks '{"url":"https://httpbin.org/post","events":["ping"]}'
  WEBHOOK=$(field "['webhook']['_id']")
  check 'POST /webhooks/:id/test' 202 POST "/webhooks/$WEBHOOK/test"
  sleep 4
  check 'GET /webhooks/:id/deliveries' 200 GET "/webhooks/$WEBHOOK/deliveries"
  [[ $(field "['deliveries'][0]['status']") == ok ]] && echo '  ok   the ping arrived' || echo '  note the ping has not arrived yet'
  check 'DELETE /webhooks/:id' 200 DELETE "/webhooks/$WEBHOOK"
  if [[ -n $AUTOMATION ]]; then
    check 'POST /hooks' 201 POST /hooks "{\"automationId\":\"$AUTOMATION\",\"name\":\"smoke test\"}"
    HOOK=$(field "['_id']")
    check 'DELETE /hooks/:id' 200 DELETE "/hooks/$HOOK"
    # 402 is right when the account has no dry runs left; 409 when a run is already going.
    check 'POST /automations/:id/runs (dry)' '202|402|409' POST "/automations/$AUTOMATION/runs" '{"dry":true}'
  fi
fi

echo "$pass passed, $fail failed"
[[ $fail == 0 ]]
