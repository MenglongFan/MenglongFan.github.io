#!/usr/bin/env bash
# 玩家不可删除（ADR 0011）· 沙盒验证
#
# 需要本地沙盒在跑：
#   cd worker && wrangler dev --port 8787 --local
#
# 要证的是：DELETE /api/player/:id 在「有历史」时**明确拒绝**，而不是让 SQLite 抛一个
# 原始外键错误、被全局 catch 变成 500（前端会把 SQLite 原文直接弹给用户）。
#
# 三条引用路径必须各自被隔离地证一遍 —— 守卫是三个 COUNT 相加，
# 漏掉任意一项就留一个洞：漏 season_players 时「刚报名还没打过」的人会 500，
# 漏 prize_pool_transactions 时捐过款的人会 500。所以三项各造一个只命中该项的玩家。
#
# 注意 POST /api/season 要求 5-10 人（第一版传了 3 人，赛季压根没建成，
# 于是「报名过赛季」那条断言的失败其实是测试自己的锅）。
#
# 断言在 sandbox_player_delete_assert.py 里，不写内联 python -c
# （在 shell 里转义 f-string 的引号是保证会踩的坑）。
#
# 所有 D1 命令都带 --local。**绝不能**在这里出现 --remote：那是线上真实数据。

set -uo pipefail

BASE=http://127.0.0.1:8787
WR="/Users/lone/Library/Application Support/TRAE SOLO CN/ModularData/ai-agent/vm/tools/npm-global/bin/wrangler"
OUT=$(mktemp -d)
trap 'echo; echo "中间产物留在 $OUT"' EXIT

# 先取绝对路径再 cd，否则从仓库根调用时断言路径会拼成 worker/worker/test/...
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
  printf '  %-34s → HTTP %s  %s\n' "$name" "$code" "$(head -c 90 "$OUT/$name.json")"
}

db() { # db <名字> <sql>
  "$WR" d1 execute guozhan-scoring --local --json --command "$2" 2>/dev/null > "$OUT/$1.json"
}

echo "════════ -1. 把沙盒恢复成已知状态（让脚本可以反复跑）════════"
echo "清业务表 + 重置 sqlite_sequence，否则 id 会漂、上一次留下的 active 赛季会让建赛季返回 409。"
"$WR" d1 execute guozhan-scoring --local --command \
  "DELETE FROM match_results; DELETE FROM matches; DELETE FROM season_players; DELETE FROM prize_pool_transactions; DELETE FROM seasons; DELETE FROM sqlite_sequence WHERE name IN ('match_results','matches','season_players','prize_pool_transactions','seasons');" \
  2>&1 | tail -1

echo "删掉测试自己加进来的玩家（只保留 schema.sql 自带的 1-7）"
"$WR" d1 execute guozhan-scoring --local --command \
  "DELETE FROM players WHERE id > 7" 2>&1 | tail -1

# **这一步不能省**：本测试会真的删玩家，跑完一遍沙盒的花名册就残缺了
# （第一版没做这一步，第二遍跑时 1 号和 5 号已经不在，断言全成了假的失败）。
# 重新灌一遍 schema.sql 即可 —— 里面全是 CREATE ... IF NOT EXISTS 和 INSERT OR IGNORE，
# 对已有数据是空操作，只会把缺的 7 个玩家补回来。
echo "重灌 schema.sql 补回花名册（幂等）"
"$WR" d1 execute guozhan-scoring --local --file=schema.sql 2>&1 | tail -1

echo
echo "════════ 0. 造引用：1-5 报名赛季；6 只有奖池流水；7 只有对局记录 ════════"
db roster_pre "SELECT id FROM players ORDER BY id"
call season_create POST /api/season \
  '{"name":"玩家删除验证赛季","player_ids":[1,2,3,4,5]}' auth
SID=$(python3 -c "import json;print(json.load(open('$OUT/season_create.json'))['id'])" 2>/dev/null)
echo "  season_id = ${SID:-<建赛季失败>}"

echo "  给 6 号插奖池流水（绕过接口，只为造出一条引用）"
db seed_ppt "INSERT INTO prize_pool_transactions (player_id, type, amount, balance) VALUES (6, 'donation', 10, 10)"

echo "  给 7 号插一条对局记录，但**不**写 season_players"
echo "  —— 这个状态是硬造出来的（现实中打过对局的人必然也报过名），"
echo "     目的只是把 match_results 那一项单独隔离出来，证明它没被漏掉。"
db seed_match "INSERT INTO matches (season_id, player_count) VALUES ($SID, 5)"
db seed_mr "INSERT INTO match_results (match_id, player_id, rank, score) SELECT id, 7, 1, 10 FROM matches WHERE season_id = $SID ORDER BY id DESC LIMIT 1"

echo
echo "════════ 1. 鉴权：无密码必须 401 ════════"
call del_noauth DELETE /api/player/1

echo
echo "════════ 2. 三条引用路径各自都该 409 ════════"
call del_season_ref  DELETE /api/player/1 '' auth   # 只命中 season_players
call del_ppt_ref     DELETE /api/player/6 '' auth   # 只命中 prize_pool_transactions
call del_match_ref   DELETE /api/player/7 '' auth   # 只命中 match_results

echo
echo "════════ 3. 全新玩家可以删，删第二次该 404 ════════"
call add_temp POST /api/player '{"name":"临时验证玩家"}' auth
TMPID=$(python3 -c "import json;print(json.load(open('$OUT/add_temp.json'))['id'])" 2>/dev/null)
echo "  新玩家 id = ${TMPID:-<添加失败>}"
call del_clean  DELETE "/api/player/$TMPID" '' auth
call del_again  DELETE "/api/player/$TMPID" '' auth
call del_ghost  DELETE /api/player/99 '' auth

echo
echo "════════ 4. 取最终库状态供断言 ════════"
db survivors  "SELECT id FROM players WHERE id <= 7 ORDER BY id"
db gone_tmp   "SELECT COUNT(*) AS n FROM players WHERE id = $TMPID"
db season_pl  "SELECT player_id FROM season_players ORDER BY player_id"

echo
echo "════════ 断言 ════════"
python3 "$HERE/sandbox_player_delete_assert.py" "$OUT" "$TMPID"
