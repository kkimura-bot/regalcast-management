#!/bin/bash
# management functions（us-central1）のcallable invoker修復（RegalVoiceのfix-invoker.shと同方式）
set -u
PROJECT=regalcast-app
REGION=us-central1
TOKEN=$(gcloud auth print-access-token)

TARGETS="deleteAuthUser adminSetUserDisabled geminiProxy"

RAW=$(curl -s -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJECT" \
  "https://run.googleapis.com/v2/projects/$PROJECT/locations/$REGION/services?pageSize=300")
SERVICES=$(echo "$RAW" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for s in d.get('services',[]):
    print(s['name'].split('/')[-1])
")
if [ -z "$SERVICES" ]; then echo "⚠️ サービス一覧が空:"; echo "$RAW" | head -c 300; exit 1; fi

OK=0; NG=0
for fn in $TARGETS; do
  key=$(echo "$fn" | tr '[:upper:]' '[:lower:]' | tr -d '_')
  svc=""
  for s in $SERVICES; do
    if [ "$(echo "$s" | tr -d '-')" = "$key" ]; then svc="$s"; break; fi
  done
  if [ -z "$svc" ]; then echo "❌ $fn: サービスが見つからない"; NG=$((NG+1)); continue; fi
  URL="https://run.googleapis.com/v2/projects/$PROJECT/locations/$REGION/services/$svc"
  BODY=$(curl -s -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJECT" "$URL:getIamPolicy" | python3 -c "
import json,sys
p=json.load(sys.stdin)
if 'error' in p: sys.exit('getIamPolicy失敗')
b=p.get('bindings',[])
for x in b:
    if x.get('role')=='roles/run.invoker':
        if 'allUsers' not in x.get('members',[]): x.setdefault('members',[]).append('allUsers')
        break
else:
    b.append({'role':'roles/run.invoker','members':['allUsers']})
p['bindings']=b
print(json.dumps({'policy':p}))
") || { echo "❌ $fn: ポリシー取得失敗"; NG=$((NG+1)); continue; }
  RES=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJECT" -H "Content-Type: application/json" -d "$BODY" "$URL:setIamPolicy")
  if echo "$RES" | grep -q '"etag"'; then echo "✅ $fn ($svc)"; OK=$((OK+1)); else echo "❌ $fn: $(echo "$RES" | head -c 150)"; NG=$((NG+1)); fi
done
echo "---"
echo "成功 $OK / 失敗 $NG"
