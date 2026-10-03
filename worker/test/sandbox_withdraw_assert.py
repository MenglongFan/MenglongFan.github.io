#!/usr/bin/env python3
"""支取奖池沙盒验证的断言。由 sandbox-withdraw.sh 调用，参数是中间产物的目录。

为什么断言单独一个文件而不是内联 python -c：在 shell 里转义 f-string 的引号
是保证会踩的坑，而且断言一多就没法读了。

金额一律换算成「分」的整数再比 —— 这一批用例故意用了 5.7 / 35.7 这种二进制不精确
的小数，用浮点直接比会得到一堆假失败（也会掩盖真的漂移）。

**但有一类断言必须用浮点直接比**：`has_float_tail()` 检查的就是「这个数是不是恰好
两位小数」。30.000000000000004 换算成分是 3000（round 掉了），只看分永远发现不了它 ——
而玩家在流水里看到的就是那个尾巴本身。
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


def has_float_tail(x):
    """x 不是「恰好两位小数」就返回 True。

    判据：把 x 按分四舍五入再还原，看是否等于 x 本身。
    30.000000000000004 → round(3000.0000000000005)/100 = 30.0 ≠ 30.000000000000004 → True
    35.7               → round(3570.0000000000005)/100 = 35.7 = 35.7               → False
    """
    if x is None:
        return True
    f = float(x)
    return f != round(f * 100) / 100


def check(label, ok, detail=""):
    global failed
    if ok:
        print(f"  ✓ {label}")
    else:
        failed += 1
        print(f"  ✗ {label}" + (f" —— {detail}" if detail else ""))


def eq(label, got, want):
    check(label, got == want, f"得到 {got!r}，期望 {want!r}")


print("── 1. 罚金入池 30 元（支取的起点）")
chain_before = rows("chain_before")
eq("罚金 3 行 + 捐赠 1 行 = 4 行", len(chain_before), 4)
fine_rows = [r for r in chain_before if r["type"] == "fine"]
eq("罚金 3 行", len(fine_rows), 3)
eq("罚金合计 3000 分", sum(cents(r["amount"]) for r in fine_rows), 3000)

print("\n── 2. 拒绝路径必须不写库")
eq("未鉴权 401", code("w_noauth"), "401")
eq("金额 0 → 400", code("w_zero"), "400")
eq("负数 → 400", code("w_negative"), "400")
eq("三位小数 → 400", code("w_3dp"), "400")
eq("超过余额 → 400", code("w_over"), "400")
eq("三位小数的报错文案", (load("w_3dp") or {}).get("error"), "支取金额最多两位小数")
eq("超额的报错文案", (load("w_over") or {}).get("error"), "奖池余额不足")
# 被拒的请求一条流水都不该留下：链还是「3 笔罚金」
rejected_chain = rows("chain_after_rejects")
eq("被拒后链上仍是 3 行", len(rejected_chain), 3)
eq("被拒后余额仍是 3000 分", cents(rejected_chain[-1]["balance"]) if rejected_chain else None, 3000)

print("\n── 3. 捐赠 5.7 元 → 余额 35.7")
donate = load("donate") or {}
eq("捐赠响应余额 3570 分", cents(donate.get("new_balance")), 3570)
eq("捐赠响应余额恰好是 35.7", donate.get("new_balance"), 35.7)
before_last = chain_before[-1] if chain_before else {}
eq("链上最后一行是 donation", before_last.get("type"), "donation")
eq("支取前余额 3570 分", cents(before_last.get("balance")), 3570)

print("\n── 4. 支取 5.7 元 —— 本次事故的核心")
print("   35.7 - 5.7 在浮点下是 30.000000000000004；不 round 就会被写进 balance 列。")
w = load("withdraw") or {}
eq("支取响应 new_balance = 30（严格相等，不是 30.000000000000004）", w.get("new_balance"), 30)
eq("支取响应 new_balance 3000 分", cents(w.get("new_balance")), 3000)
check(
    "支取响应 new_balance 没有浮点尾巴",
    not has_float_tail(w.get("new_balance")),
    f"得到 {w.get('new_balance')!r}",
)

chain_after = rows("chain_after")
withdrawal_row = next((r for r in chain_after if r["type"] == "withdrawal"), None)
check("链上有一行 withdrawal", withdrawal_row is not None)
if withdrawal_row:
    eq("流水行金额 -5.7 元", cents(withdrawal_row["amount"]), -570)
    eq("流水行余额 3000 分", cents(withdrawal_row["balance"]), 3000)
    check(
        "**流水行余额没有浮点尾巴**（玩家看到的就是这个数）",
        not has_float_tail(withdrawal_row["balance"]),
        f"得到 {withdrawal_row['balance']!r} —— 这就是线上那个 30.000000000000004",
    )

summary_after = load("summary_after") or {}
eq("汇总 current_balance 3000 分", cents(summary_after.get("current_balance")), 3000)
check(
    "汇总 current_balance 没有浮点尾巴",
    not has_float_tail(summary_after.get("current_balance")),
    f"得到 {summary_after.get('current_balance')!r}",
)

print("\n── 5. 流水接口返回的每个余额都必须是两位小数")
tx = load("tx") or {}
tx_rows = tx.get("transactions") or []
eq("流水共 5 笔（3 罚金 + 1 捐赠 + 1 支取）", len(tx_rows), 5)
bad = [r for r in tx_rows if has_float_tail(r.get("balance"))]
check(
    "没有任何一笔余额带浮点尾巴",
    not bad,
    "; ".join(f"#{r['id']} {r['balance']!r}" for r in bad),
)
bad_amt = [r for r in tx_rows if has_float_tail(r.get("amount"))]
check("没有任何一笔金额带浮点尾巴", not bad_amt, "; ".join(f"#{r['id']} {r['amount']!r}" for r in bad_amt))

print("\n── 6. 余额链自洽：逐行重算 == 前值 + 金额")
running = 0
for r in chain_after:
    running = round((running + float(r["amount"])) * 100) / 100
    eq(f"#{r['id']} {r['type']} 余额续得上", cents(r["balance"]), cents(running))

print("\n── 7. 恰好取完 30 元 → 余额是 0，不是 1e-16")
wa = load("withdraw_all") or {}
eq("清空响应 new_balance = 0（严格相等）", wa.get("new_balance"), 0)
eq("清空响应 0 分", cents(wa.get("new_balance")), 0)
chain_final = rows("chain_final")
eq("链上最后一行余额 0 分", cents(chain_final[-1]["balance"]) if chain_final else None, 0)
check(
    "没有出现负数余额",
    all(cents(r["balance"]) >= 0 for r in chain_final),
    "; ".join(f"#{r['id']} {r['balance']!r}" for r in chain_final if cents(r["balance"]) < 0),
)
summary_empty = load("summary_empty") or {}
eq("清空后汇总余额 0 分", cents(summary_empty.get("current_balance")), 0)

print(f"\n{'失败 %d 项' % failed if failed else '全部通过'}")
sys.exit(1 if failed else 0)
