#!/usr/bin/env bash
# 支取奖池 · 沙盒验证
#
# 需要本地沙盒在跑：
#   cd worker && wrangler dev --port 8787 --local
#
# 为什么不并进 sandbox-donations.sh：那个脚本演的是「捐赠与删除」的账目不变式，
# 跑到收尾时余额已经不是一个能精确复刻事故的值了。这里要的是**一个确定的余额**：
# 30 元罚金 + 5.7 元捐赠 = 35.7，再取 5.7 —— 而 35.7 - 5.7 在浮点下等于
# 30.000000000000004，线上真的把这个尾巴写进了 balance 列（id 15），
# 于是奖池流水里写「余额 30.000000000000004 元」。
#
# **复刻这个数才算真的测到。** 随便挑个金额（比如 30 - 5.7）减法恰好是干净的，
# 测试会绿，而 bug 还在。挑金额时先用 node 验一下 `b - a` 是不是真的飘。
#
# 断言全部在 sandbox_withdraw_assert.py 里，不写成内联的 python -c ——
# 在 shell 里转义 f-string 的引号是保证会踩的坑。
#
# 所有 D1 命令都带 --local。**绝不能**在这里出现 --remote：那是线上真实数据。

set -uo pipefail

BASE=http://127.0.0.1:8787
WR="/Users/lone/Library/Application Support/TRAE SOLO CN/ModularData/ai-agent/vm/tools/npm-global/bin/wrangler"
OUT=$(mktemp -d)
trap 'echo; echo "中间产物留在 $OUT"' EXIT

# 先取绝对路径再 cd。脚本开头会 cd 到 worker/，之后 "$(dirname "$0")" 就是相对的了：
# 从仓库根跑 `bash worker/test/sandbox-withdraw.sh` 会拼成 worker/worker/test/...，
# 断言那一行会以「文件不存在」失败，而前面所有段看起来都正常 —— 白跑一遍。
HERE=$(cd "$(dirname "$0")" && pwd)
cd "$HERE/.." || exit 1
. "$HERE/sandbox-env.sh"   # 取沙盒口令（只从 .dev.vars 读，见该文件顶部说明）

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

echo "════════ 0. 清空沙盒库（让脚本可以反复跑）════════"
echo "清业务表 + 重置 sqlite_sequence，否则 id 会漂、上一次留下的 active 赛季会让建赛季返回 409。"
echo "花名册（players）不动 —— 7 个玩家是 schema.sql 里带的。"
"$WR" d1 execute guozhan-scoring --local --command \
  "DELETE FROM match_results; DELETE FROM matches; DELETE FROM season_players; DELETE FROM prize_pool_transactions; DELETE FROM seasons; DELETE FROM sqlite_sequence WHERE name IN ('match_results','matches','season_players','prize_pool_transactions','seasons');" \
  2>&1 | tail -1

echo
echo "════════ 1. 造一个 5 人赛季并结束 → 罚金 30 元入池 ════════"
echo "目的：拿到一个整数 30 元的起点。之后 +5.7 就是 35.7，事故前夜的那个余额。"
call season_create POST /api/season \
  '{"name":"支取验证赛季","player_ids":[1,2,3,4,5]}' auth
SID=$(python3 -c "import json;print(json.load(open('$OUT/season_create.json'))['id'])")
echo "  season_id = $SID"

# 5 人：1 号存活，2-5 号按录入顺序阵亡 → 分数 5/4/3/2/1
# 末三位（3/2/1 分）缴 5/10/15 元，合计 30 元
call match_record POST /api/match \
  "{\"season_id\":$SID,\"results\":[{\"player_id\":1,\"rank\":1,\"is_survivor\":1},{\"player_id\":2,\"rank\":1,\"is_survivor\":0},{\"player_id\":3,\"rank\":2,\"is_survivor\":0},{\"player_id\":4,\"rank\":3,\"is_survivor\":0},{\"player_id\":5,\"rank\":4,\"is_survivor\":0}]}" auth
call season_end POST "/api/season/$SID/end" '{}' auth

echo
echo "════════ 2. 校验支取输入（此时余额 30 元，全部应被拒）════════"
echo "先测拒绝路径：它们都必须在写库之前返回，余额链不能被碰。"
call w_noauth   POST /api/prize-pool/withdraw '{"amount":1}'
call w_zero     POST /api/prize-pool/withdraw '{"amount":0}' auth
call w_negative POST /api/prize-pool/withdraw '{"amount":-5}' auth
call w_3dp      POST /api/prize-pool/withdraw '{"amount":1.234}' auth
call w_over     POST /api/prize-pool/withdraw '{"amount":99999}' auth
db chain_after_rejects "SELECT id, type, amount, balance FROM prize_pool_transactions ORDER BY id ASC"

echo
echo "════════ 3. 捐赠 5.7 元 → 余额 35.7（事故前夜）════════"
call donate POST /api/prize-pool/donate '{"player_id":1,"amount":5.7,"description":"事故复现"}' auth
call summary_before GET /api/prize-pool/summary
db chain_before "SELECT id, type, amount, balance FROM prize_pool_transactions ORDER BY id ASC"

echo
echo "════════ 4. 支取 5.7 元 —— 就是会飘的那一笔 ════════"
echo "35.7 - 5.7 = 30.000000000000004。修之前这个尾巴会被原样写进 balance 列。"
call withdraw POST /api/prize-pool/withdraw '{"amount":5.7,"description":"复现浮点漂移"}' auth
call summary_after GET /api/prize-pool/summary
call tx GET '/api/prize-pool/transactions?limit=200'
db chain_after "SELECT id, type, amount, balance FROM prize_pool_transactions ORDER BY id ASC"

echo
echo "════════ 5. 恰好取完（30 元）→ 余额必须是 0，不是 1e-16 ════════"
call withdraw_all POST /api/prize-pool/withdraw '{"amount":30,"description":"清空"}' auth
call summary_empty GET /api/prize-pool/summary
db chain_final "SELECT id, type, amount, balance FROM prize_pool_transactions ORDER BY id ASC"

echo
echo "════════ 断言 ════════"
python3 "$HERE/sandbox_withdraw_assert.py" "$OUT"
