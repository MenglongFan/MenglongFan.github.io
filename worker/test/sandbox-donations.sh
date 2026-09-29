#!/usr/bin/env bash
# 慈善捐赠 · 沙盒状态机验证
#
# 需要本地沙盒在跑：
#   cd worker && wrangler dev --port 8787 --local
#
# 为什么要脚本化而不是点一遍 UI：这里真正要证的是**余额链**和**跨切片的账目不变式**
# （贡献榜不受捐赠影响、捐赠不进赛季结算），这些用 curl 几秒钟就能跑完整个矩阵、
# 还能每次从干净库重来。UI 那一遍只需要证明交互接对了，不该背正确性的包袱。
#
# 断言全部在 sandbox_donations_assert.py 里，不写成内联的 python -c ——
# 在 shell 里转义 f-string 的引号是保证会踩的坑。
#
# 所有 D1 命令都带 --local。**绝不能**在这里出现 --remote：那是线上真实数据。

set -uo pipefail

BASE=http://127.0.0.1:8787
KEY=local-sandbox-key
WR="/Users/lone/Library/Application Support/TRAE SOLO CN/ModularData/ai-agent/vm/tools/npm-global/bin/wrangler"
OUT=$(mktemp -d)
trap 'echo; echo "中间产物留在 $OUT"' EXIT

# 先取绝对路径再 cd。脚本开头会 cd 到 worker/，之后 "$(dirname "$0")" 就是相对的了：
# 从仓库根跑 `bash worker/test/sandbox-donations.sh` 会拼成 worker/worker/test/...，
# 断言那一行会以「文件不存在」失败，而前面所有段看起来都正常 —— 白跑两分半。
HERE=$(cd "$(dirname "$0")" && pwd)
cd "$HERE/.." || exit 1

call() { # call <名字> <方法> <路径> [json] [auth]
  local name=$1 method=$2 path=$3 json=${4:-} auth=${5:-}
  local args=(-s -o "$OUT/$name.json" -w '%{http_code}' -X "$method" "$BASE$path")
  [ -n "$json" ] && args+=(-H 'Content-Type: application/json' -d "$json")
  [ -n "$auth" ] && args+=(-H "X-House-Key: $KEY")
  local code
  code=$(curl "${args[@]}")
  echo "$code" > "$OUT/$name.code"
  printf '  %-40s → HTTP %s  %s\n' "$name" "$code" "$(head -c 90 "$OUT/$name.json")"
}

db() { # db <名字> <sql>
  "$WR" d1 execute guozhan-scoring --local --json --command "$2" 2>/dev/null > "$OUT/$1.json"
}

echo "════════ -1. 清空沙盒库（让脚本可以反复跑）════════"
echo "清业务表 + 重置 sqlite_sequence，否则 id 会漂、上一次留下的 active 赛季会让建赛季返回 409。"
echo "花名册（players）不动 —— 7 个玩家是 schema.sql 里带的。"
"$WR" d1 execute guozhan-scoring --local --command \
  "DELETE FROM match_results; DELETE FROM matches; DELETE FROM season_players; DELETE FROM prize_pool_transactions; DELETE FROM seasons; DELETE FROM sqlite_sequence WHERE name IN ('match_results','matches','season_players','prize_pool_transactions','seasons');" \
  2>&1 | tail -1

echo
echo "════════ 0. 前置：造一个赛季，让罚金先入账 ════════"
echo "目的：让贡献榜里先有罚金，之后才验证捐赠不会混进去。"
call season_create POST /api/season \
  '{"name":"沙盒验证赛季","player_ids":[1,2,3,4,5]}' auth
SID=$(python3 -c "import json;print(json.load(open('$OUT/season_create.json'))['id'])")
echo "  season_id = $SID"

# 5 人：1 号存活，2-5 号按录入顺序阵亡 → 分数 5/4/3/2/1
# 末三位（3/2/1 分）缴 5/10/15 元，合计 30 元
call match_record POST /api/match \
  "{\"season_id\":$SID,\"results\":[{\"player_id\":1,\"rank\":1,\"is_survivor\":1},{\"player_id\":2,\"rank\":1,\"is_survivor\":0},{\"player_id\":3,\"rank\":2,\"is_survivor\":0},{\"player_id\":4,\"rank\":3,\"is_survivor\":0},{\"player_id\":5,\"rank\":4,\"is_survivor\":0}]}" auth
call season_end POST "/api/season/$SID/end" '{}' auth

db contrib_before "SELECT p.name, SUM(ppt.amount) AS total FROM prize_pool_transactions ppt JOIN players p ON p.id=ppt.player_id WHERE ppt.type='fine' GROUP BY p.id ORDER BY total DESC"
echo "  罚金入账后的贡献榜：$(cat "$OUT/contrib_before.json" | python3 -c "import sys,json;print([ (r['name'],r['total']) for r in json.load(sys.stdin)[0]['results']])")"

echo
echo "════════ 1. 录入捐赠：四档门槛逐个踩 ════════"
echo "每人两笔：一笔落在门槛下方（拿低档），一笔补到门槛（升档）。"
echo "金额故意用 .99/.01 —— 都是二进制不精确的小数，正好压一压浮点漂移。"

donate() { # donate <名字> <player_id> <金额> [备注]
  local name=$1 pid=$2 amt=$3 desc=${4:-}
  call "$name" POST /api/prize-pool/donate \
    "{\"player_id\":$pid,\"amount\":$amt,\"description\":\"$desc\"}" auth
  echo "         └ $(python3 -c "import json;d=json.load(open('$OUT/$name.json'));print(f\"累计 {d.get('player_total')} 元 · 称谓「{d.get('title') or '无'}」· 余额 {d.get('new_balance')}\")" 2>/dev/null || echo '(解析失败)')"
}

# 1 樊梦龙：4 → 5        门槛 5：解囊相助
donate d1 1 4      '第一笔'
donate d2 1 1      '补到 5'
# 2 齐济：  19.99 → 20   门槛 20：仗义疏财
donate d3 2 19.99  '第一笔'
donate d4 2 0.01   '补到 20'
# 3 赵振东：49.99 → 50   门槛 50：乐善好施
donate d5 3 49.99  '第一笔'
donate d6 3 0.01   '补到 50'
# 4 李晓阳：99.99 → 100  门槛 100：义薄云天
donate d7 4 99.99  '第一笔'
donate d8 4 0.01   '补到 100'

echo
echo "════════ 2. 汇总：余额、捐赠总额、捐赠榜 ════════"
call summary GET /api/prize-pool/summary
python3 -c "
import json
d=json.load(open('$OUT/summary.json'))
print(f\"  余额 {d['current_balance']} 元 · 其中慈善 {d['donation_total']} 元 · 罚金贡献榜 {len(d['contributions'])} 人\")
for x in d['donors']:
    print(f\"    {x['name']:<6} 累计 {x['total_amount']:>7} 元 · {x['donation_count']} 笔 · 称谓「{x['title'] or '无'}」\")
"

echo
echo "════════ 3. 输入校验（全部应被拒）════════"
call v_noauth    POST /api/prize-pool/donate '{"player_id":1,"amount":1}'
call v_noplayer  POST /api/prize-pool/donate '{"amount":1}' auth
call v_ghost     POST /api/prize-pool/donate '{"player_id":999,"amount":1}' auth
call v_zero      POST /api/prize-pool/donate '{"player_id":1,"amount":0}' auth
call v_negative  POST /api/prize-pool/donate '{"player_id":1,"amount":-5}' auth
call v_3dp       POST /api/prize-pool/donate '{"player_id":1,"amount":1.234}' auth

echo
echo "════════ 4. 逐笔列表 ════════"
call donations GET '/api/prize-pool/donations?limit=200'

echo
echo "════════ 5. 删除前的余额链快照（关键证据）════════"
db chain_before "SELECT id, type, amount, balance, player_id FROM prize_pool_transactions ORDER BY id ASC"
python3 -c "
import json
rows=json.load(open('$OUT/chain_before.json'))[0]['results']
print(f'  共 {len(rows)} 行')
for r in rows:
    print(f\"    #{r['id']:<3} {r['type']:<10} {r['amount']:>8} → 余额 {r['balance']}\")
"

echo
echo "════════ 6. 删除中间一笔（最早那笔捐赠）════════"
echo "删的是 id 最小的那笔 donation —— 它后面还剩 6 行，全都得重算余额。"
echo "选最早的一笔是故意的：只改被删那条、或者只改最后一条的实现，都会在这里露馅。"
echo "同时樊梦龙的累计额会从 5 掉到 1 —— 跨过 5 元门槛向下，称谓必须回退成「无」。"
DELID=$(python3 -c "
import json
rows=json.load(open('$OUT/chain_before.json'))[0]['results']
# 找第一笔捐赠（id 最小的 donation 行）
print(next(r['id'] for r in rows if r['type']=='donation'))
")
echo "  被删 id = $DELID，金额 = $(python3 -c "
import json
rows=json.load(open('$OUT/chain_before.json'))[0]['results']
print(next(r['amount'] for r in rows if r['id']==$DELID))
") 元"
call delete_mid DELETE "/api/prize-pool/donation/$DELID" '' auth

echo
echo "════════ 7. 删除后的余额链 ════════"
db chain_after "SELECT id, type, amount, balance, player_id FROM prize_pool_transactions ORDER BY id ASC"
python3 -c "
import json
rows=json.load(open('$OUT/chain_after.json'))[0]['results']
print(f'  共 {len(rows)} 行')
for r in rows:
    print(f\"    #{r['id']:<3} {r['type']:<10} {r['amount']:>8} → 余额 {r['balance']}\")
"

echo
echo "════════ 8. 类型守卫与不存在 ════════"
FINEID=$(python3 -c "
import json
rows=json.load(open('$OUT/chain_after.json'))[0]['results']
print(next(r['id'] for r in rows if r['type']=='fine'))
")
echo "  拿罚金行 id=$FINEID 去删（必须被拒）"
call del_fine DELETE "/api/prize-pool/donation/$FINEID" '' auth
call del_ghost DELETE "/api/prize-pool/donation/99999" '' auth

echo
echo "════════ 9. 删除后的汇总与贡献榜 ════════"
call summary_after GET /api/prize-pool/summary
call donations_after GET '/api/prize-pool/donations?limit=200'
db contrib_after "SELECT p.name, SUM(ppt.amount) AS total FROM prize_pool_transactions ppt JOIN players p ON p.id=ppt.player_id WHERE ppt.type='fine' GROUP BY p.id ORDER BY total DESC"

echo
echo "════════ 9b. 分页契约（前端「加载更多」依赖它）════════"
echo "只验接口：两页不重叠、total 稳定、offset 越界返回空而不是报错。"
call donations_p1 GET '/api/prize-pool/donations?limit=3&offset=0'
call donations_p2 GET '/api/prize-pool/donations?limit=3&offset=3'
call donations_past GET '/api/prize-pool/donations?limit=3&offset=999'

echo
echo "════════ 10. 捐过款的玩家删不掉，所以账不会静默消失（story 53）════════"
echo "players 被 match_results 和 prize_pool_transactions 外键引用，且都没有 ON DELETE CASCADE，"
echo "而 D1 是**开着外键强制**的（直接 DELETE 会以 FOREIGN KEY constraint failed 失败，退出码 1）。"
echo "也就是说「删掉一个捐过款的玩家」在数据库层面就做不到 —— 不存在「删掉了、捐赠额却少算」这种状态。"
echo "所以这一节断言的是这个结构性事实，**不真去删**（删不动，也没必要冒险）。"
db fk_to_players "SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE '%REFERENCES players%' ORDER BY name"
db fk_cascade "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND sql LIKE '%ON DELETE CASCADE%'"
db donation_ledger_sum "SELECT ROUND(COALESCE(SUM(amount),0),2) AS ledger_sum, COUNT(*) AS rows_n FROM prize_pool_transactions WHERE type='donation'"
call summary_player_fk GET /api/prize-pool/summary

echo
echo "════════ 断言 ════════"
python3 "$HERE/sandbox_donations_assert.py" "$OUT"
