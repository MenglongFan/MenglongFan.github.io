#!/usr/bin/env python3
"""慈善捐赠沙盒验证的断言。由 sandbox-donations.sh 调用，参数是中间产物的目录。

为什么断言单独一个文件而不是内联 python -c：在 shell 里转义 f-string 的引号
是保证会踩的坑，而且断言一多就没法读了。

金额一律换算成「分」的整数再比 —— 这一批用例故意用了 19.99 / 0.01 / 49.99 / 99.99
这些二进制不精确的小数，用浮点直接比会得到一堆假失败（也会掩盖真的漂移）。
"""

import json
import sys
from pathlib import Path

OUT = Path(sys.argv[1])
failed = 0


def load(name):
    p = OUT / f"{name}.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except json.JSONDecodeError:
        return None


def code(name):
    p = OUT / f"{name}.code"
    return p.read_text().strip() if p.exists() else "(缺失)"


def rows(name):
    """D1 --json 的输出是 [{results:[...]}]"""
    d = load(name)
    return d[0]["results"] if d else []


def cents(x):
    # 拿不到值时返回 None 而不是抛异常 —— 断言失败应该是「报告一行 ✗」，
    # 不是让整个脚本崩在中间，那样后面的断言就全都没跑了。
    return None if x is None else round(float(x) * 100)


def check(label, ok, detail=""):
    global failed
    if ok:
        print(f"  ✓ {label}")
    else:
        failed += 1
        print(f"  ✗ {label}" + (f" —— {detail}" if detail else ""))


def eq(label, got, want):
    check(label, got == want, f"得到 {got!r}，期望 {want!r}")


print("── 1. 罚金先入账（贡献榜的基线）")
# 5 人：1 号存活得分 5，2-5 号按录入顺序阵亡得分 4/3/2/1。
# 末三位是 3 分（赵振东）/ 2 分（李晓阳）/ 1 分（范昊宇），对应缴 5 / 10 / 15 元。
contrib_before = {r["name"]: cents(r["total"]) for r in rows("contrib_before")}
eq("贡献榜 3 人", len(contrib_before), 3)
eq("末位（1 分）缴 1500 分", contrib_before.get("范昊宇"), 1500)
eq("倒数第二（2 分）缴 1000 分", contrib_before.get("李晓阳"), 1000)
eq("倒数第三（3 分）缴 500 分", contrib_before.get("赵振东"), 500)
eq("罚金合计 3000 分", sum(contrib_before.values()), 3000)

print("\n── 2. 每笔捐赠的累计额与称谓（档位边界）")
# (响应名, 期望累计额/分, 期望称谓)
EXPECT = [
    ("d1", 400, ""),               # 4 元：够不着 5
    ("d2", 500, "解囊相助"),      # 恰好 5 元即达标
    ("d3", 1999, "解囊相助"),      # 19.99 只差 1 分到 20，仍停在第一档
    ("d4", 2000, "仗义疏财"),      # 恰好 20
    ("d5", 4999, "仗义疏财"),      # 49.99 只差 1 分到 50
    ("d6", 5000, "乐善好施"),      # 恰好 50
    ("d7", 9999, "乐善好施"),      # 99.99 只差 1 分到 100
    ("d8", 10000, "义薄云天"),     # 恰好 100
]
for name, want_total, want_title in EXPECT:
    d = load(name)
    if not d:
        check(f"{name} 有响应", False, "响应缺失或不是 JSON")
        continue
    eq(f"{name} 累计 {want_total / 100} 元", cents(d.get("player_total")), want_total)
    eq(f"{name} 称谓「{want_title or '无'}」", d.get("title") or "", want_title)

print("\n── 3. 汇总：余额 / 慈善总额 / 捐赠榜")
s = load("summary")
if not s:
    check("summary 可解析", False)
else:
    eq("余额 = 罚金 30 + 捐赠 175 = 205 元", cents(s["current_balance"]), 20500)
    eq("其中慈善 175 元", cents(s["donation_total"]), 17500)
    eq("捐赠榜 4 人", len(s["donors"]), 4)
    got = [(x["name"], cents(x["total_amount"]), x["title"]) for x in s["donors"]]
    want = [
        ("李晓阳", 10000, "义薄云天"),
        ("赵振东", 5000, "乐善好施"),
        ("齐济", 2000, "仗义疏财"),
        ("樊梦龙", 500, "解囊相助"),
    ]
    eq("捐赠榜按累计额降序且称谓正确", got, want)
    eq("捐赠榜不含罚金（3 位缴罚金的人不在榜上）", [x["name"] for x in s["donors"]].count("范昊宇"), 0)
    eq("罚金贡献榜仍是 3 人，未被捐赠污染", len(s["contributions"]), 3)

print("\n── 4. 输入校验：全部应被拒")
eq("未带房主密码 → 401", code("v_noauth"), "401")
eq("缺 player_id → 400", code("v_noplayer"), "400")
eq("玩家不存在 → 400", code("v_ghost"), "400")
eq("金额 0 → 400", code("v_zero"), "400")
eq("金额为负 → 400", code("v_negative"), "400")
eq("三位小数 → 400", code("v_3dp"), "400")
# 校验失败不能留下任何痕迹
eq("校验失败没有写入任何流水", len(rows("chain_before")), 3 + 8)

print("\n── 5. 逐笔列表")
d = load("donations")
if not d:
    check("donations 可解析", False)
else:
    eq("共 8 笔", d["total"], 8)
    eq("返回 8 条", len(d["donations"]), 8)
    item = d["donations"][0]
    for field in ("player_name", "amount", "balance", "created_at", "id"):
        check(f"逐笔记录含 {field}", field in item and item[field] is not None)
    eq("备注被保存（第一笔）", d["donations"][-1].get("description"), "第一笔")

print("\n── 6. 删除前的余额链自洽")
before = rows("chain_before")
eq("删除前 11 行（3 罚金 + 8 捐赠）", len(before), 11)
ok, bad = True, None
prev = 0
for r in before:
    if cents(r["balance"]) != prev + cents(r["amount"]):
        ok, bad = False, r
        break
    prev = cents(r["balance"])
check("每一行余额 = 前一行余额 + 本行金额", ok, f"在 #{bad['id']} 处断裂" if bad else "")
eq("链尾余额 205 元", cents(before[-1]["balance"]), 20500)
check("全部 8 笔捐赠都没有绑定赛季",
      all(r.get("season_id") is None for r in before if r["type"] == "donation"))

print("\n── 7. 删除中间一笔（最早那笔捐赠：樊梦龙的 4 元）")
eq("删除返回 200", code("delete_mid"), "200")
dm = load("delete_mid")
if dm:
    # 205 - 4 = 201
    eq("返回新余额 201 元", cents(dm["new_balance"]), 20100)
    check("报告了被重写的行数", dm.get("rewritten", 0) >= 1, f"rewritten={dm.get('rewritten')}")
    # 被删的是 id=4，它后面还有 id 5..11 共 7 行，每一行都要重写
    eq("被重写的行数 = 被删行之后剩下的行数（7）", dm.get("rewritten"), 7)

print("\n── 8. 删除后的余额链：**每一行都要重算**")
after = rows("chain_after")
eq("删除后 10 行", len(after), 10)
ids_before = [r["id"] for r in before]
ids_after = [r["id"] for r in after]
deleted = [i for i in ids_before if i not in ids_after]
eq("恰好删掉一行", len(deleted), 1)
check("被删的是捐赠行", all(
    r["type"] == "donation" for r in before if r["id"] in deleted))

ok, bad = True, None
prev = 0
for r in after:
    if cents(r["balance"]) != prev + cents(r["amount"]):
        ok, bad = False, r
        break
    prev = cents(r["balance"])
check("删除后每一行余额 = 新前驱余额 + 本行金额", ok,
      f"在 #{bad['id']}（{bad['type']} {bad['amount']}）处断裂，余额为 {bad['balance']}" if bad else "")
eq("链尾余额 201 元", cents(after[-1]["balance"]), 20100)

# 单独点名「被删行之后的那几行」——只改被删那条或只改最后一条都会在这里露馅
tail_ok = True
prev = None
for r in after:
    if prev is None:
        prev = cents(r["balance"])
        continue
    if cents(r["balance"]) != prev + cents(r["amount"]):
        tail_ok = False
        break
    prev = cents(r["balance"])
check("被删行之后的每一行都被重写（不是只改一条）", tail_ok)

print("\n── 9. 称谓掉档回退")
sa = load("summary_after")
if not sa:
    check("summary_after 可解析", False)
else:
    eq("余额 201 元（205 - 4）", cents(sa["current_balance"]), 20100)
    eq("慈善总额 171 元（175 - 4）", cents(sa["donation_total"]), 17100)
    donors = {x["name"]: (cents(x["total_amount"]), x["title"]) for x in sa["donors"]}
    eq("樊梦龙累计掉到 1 元（只剩那笔 1 元）", donors.get("樊梦龙", (None, None))[0], 100)
    eq("樊梦龙称谓回退成「无」", donors.get("樊梦龙", (None, None))[1] or "", "")
    eq("齐济仍是仗义疏财（未受影响）", donors.get("齐济", (None, None))[1], "仗义疏财")
    eq("李晓阳仍是义薄云天", donors.get("李晓阳", (None, None))[1], "义薄云天")
    eq("捐赠榜仍有 4 人（累计额归零也没掉出榜）", len(sa["donors"]), 4)

da = load("donations_after")
if da:
    eq("逐笔列表减为 7 笔", da["total"], 7)

print("\n── 10. 跨切片：贡献榜不受捐赠影响")
contrib_after = {r["name"]: cents(r["total"]) for r in rows("contrib_after")}
eq("贡献榜内容与捐赠前完全一致", contrib_after, contrib_before)

print("\n── 11. 类型守卫")
eq("拿罚金行的 id 去删 → 400", code("del_fine"), "400")
eq("删不存在的记录 → 404", code("del_ghost"), "404")

print("\n── 12. 分页契约（前端「加载更多」依赖它）")
p1 = load("donations_p1")
p2 = load("donations_p2")
past = load("donations_past")
if not (p1 and p2 and past):
    check("分页响应可解析", False)
else:
    ids1 = [d["id"] for d in p1["donations"]]
    ids2 = [d["id"] for d in p2["donations"]]
    eq("第一页取 3 条", len(ids1), 3)
    eq("第二页取 3 条", len(ids2), 3)
    eq("两页不重叠", set(ids1) & set(ids2), set())
    # 翻页时 total 必须还是全量笔数，否则前端算不出「还有几笔」
    eq("两页报的 total 一致", (p1["total"], p2["total"]), (7, 7))
    eq("offset 越界返回空列表而不是报错", (code("donations_past"), past["donations"]), ("200", []))
    eq("越界时 total 仍是全量", past["total"], 7)

print("\n── 13. 捐过款的玩家删不掉：账不会静默消失（story 53）")
# 最初的写法是「真去删一个捐过款的玩家，再断言捐赠总额没掉」。跑出来两条失败，
# 查明原因后是**测试的前提不成立**：prize_pool_transactions.player_id 也外键引用 players，
# 而 D1 开着外键强制，所以「删掉一个捐过款的玩家」这件事根本做不到。
# 于是改成断言那个结构性事实本身 —— 更准，也不用去冒险删数据。
refs = sorted(r["name"] for r in rows("fk_to_players"))
check("match_results 外键引用 players", "match_results" in refs, f"实际引用方：{refs}")
check("prize_pool_transactions 外键引用 players",
      "prize_pool_transactions" in refs, f"实际引用方：{refs}")
casc = rows("fk_cascade")
eq("全库没有任何 ON DELETE CASCADE（删父行一律被拒，不会静默带走子行）",
   casc[0]["n"] if casc else None, 0)

ledger = rows("donation_ledger_sum")
s_fk = load("summary_player_fk")
if ledger and s_fk:
    eq("慈善总额恒等于流水合计（不依赖 players 的 JOIN）",
       cents(s_fk["donation_total"]), cents(ledger[0]["ledger_sum"]))
    eq("慈善总额 171 元", cents(s_fk["donation_total"]), 17100)

print(f"\n{'失败 %d 项' % failed if failed else '全部通过'}")
sys.exit(1 if failed else 0)
