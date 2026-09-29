#!/usr/bin/env python3
"""sandbox-player-delete.sh 的断言。

读该脚本留下的 $OUT 目录（HTTP 状态码、响应体、D1 查询结果），逐条断言。
不通过就退出码 1，并打印全部失败项。
"""
import json
import sys
from pathlib import Path

OUT = Path(sys.argv[1])
TMPID = sys.argv[2] if len(sys.argv) > 2 else ""

failures = []
checked = 0


def check(desc, cond, detail=""):
    global checked
    checked += 1
    if cond:
        print(f"  ✓ {desc}")
    else:
        print(f"  ✗ {desc}" + (f"  —— {detail}" if detail else ""))
        failures.append(desc)


def code(name):
    return (OUT / f"{name}.code").read_text().strip()


def body(name):
    return json.loads((OUT / f"{name}.json").read_text())


def rows(name):
    """D1 --json 的输出是 [{results: [...], success: true, meta: {...}}]。"""
    return json.loads((OUT / f"{name}.json").read_text())[0]["results"]


print("─ 前置：造引用这一步本身要成功，否则后面的断言是假通过")
roster_pre = [r["id"] for r in rows("roster_pre")]
check("花名册已恢复成 1-7", roster_pre == [1, 2, 3, 4, 5, 6, 7], f"实际 {roster_pre}")
season_pl_ids = {r["player_id"] for r in rows("season_pl")}
check("赛季名单已建立（1-5）", season_pl_ids == {1, 2, 3, 4, 5}, f"实际 {sorted(season_pl_ids)}")
check("临时玩家 id 拿到了", TMPID.isdigit(), f"实际 {TMPID!r}")

print("─ 鉴权")
check("无密码 → 401", code("del_noauth") == "401", f"实际 {code('del_noauth')}")

print("─ 三条引用路径都必须 409，且不能漏出原始数据库错误")
for name, label in (
    ("del_season_ref", "只报名过赛季"),
    ("del_ppt_ref", "只有奖池流水"),
    ("del_match_ref", "只有对局记录"),
):
    c = code(name)
    msg = body(name).get("error", "")
    check(f"{label} → 409", c == "409", f"实际 {c}，响应 {msg!r}")
    check(
        f"{label} 的提示是人话",
        bool(msg) and "FOREIGN KEY" not in msg and "D1_ERROR" not in msg,
        f"响应 {msg!r}",
    )

print("─ 全新玩家：删得掉，第二次 404")
check("无引用玩家 → 200", code("del_clean") == "200", f"实际 {code('del_clean')}")
check("响应是 {ok:true}", body("del_clean") == {"ok": True}, f"实际 {body('del_clean')}")
check("重复删除 → 404（不再谎报成功）", code("del_again") == "404", f"实际 {code('del_again')}")
check("不存在的玩家 → 404", code("del_ghost") == "404", f"实际 {code('del_ghost')}")

print("─ 库里确实没被删错")
survivors = {r["id"] for r in rows("survivors")}
check("1-7 号一个都没少", survivors == {1, 2, 3, 4, 5, 6, 7}, f"实际 {sorted(survivors)}")
check("临时玩家确实被删了", rows("gone_tmp")[0]["n"] == 0, f"实际 {rows('gone_tmp')}")
check("赛季名单未被连带清空", season_pl_ids == {1, 2, 3, 4, 5}, f"实际 {sorted(season_pl_ids)}")

print()
if failures:
    print(f"{checked} 项断言，{len(failures)} 项失败：")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print(f"{checked} 项断言全过 ✓")
