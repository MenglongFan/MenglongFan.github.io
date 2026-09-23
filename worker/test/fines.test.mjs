#!/usr/bin/env node
// 末位罚金算法测试：node worker/test/fines.test.mjs
//
// 为什么要把函数从 src/index.js 里「切出来」跑，而不是 import 或重写一份：
//   - 它不是 export 的，import 拿不到；
//   - 在测试里重写一遍算法，测的就是测试里那份，实现改了测试也不会红 —— 等于没测。
// 切源码能保证跑的就是线上那份代码。代价是 src/index.js 的结构不能乱动：
// 下面两个锚点（TIER_AMOUNTS_CENTS / 「获取当前奖池余额」）一旦消失就会直接报错退出，
// 而不是静默跳过。

import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8')

const START = 'const TIER_AMOUNTS_CENTS'
const END = '// 获取当前奖池余额'
const start = src.indexOf(START)
const end = src.indexOf(END)
if (start < 0 || end < 0 || end <= start) {
  console.error('切不出 calculateBottomThreeFines —— src/index.js 的锚点变了，请同步更新本测试')
  process.exit(1)
}
const calculateBottomThreeFines = new Function(
  `${src.slice(start, end)}; return calculateBottomThreeFines`,
)()

// ---- 旧实现，仅作回归对照 ----
// 旧版硬取 `standings.slice(-3)`，并列组一旦跨过末三位这条线就会漏人。
// 凡是并列组不跨界的输入，新旧结果必须逐分一致。
function oldFines(standings) {
  if (standings.length < 3) return []
  const bottom = standings.slice(-3).slice().sort((a, b) => a.total_score - b.total_score)
  const [p1, p2, p3] = bottom
  const [s1, s2, s3] = [p1.total_score, p2.total_score, p3.total_score]
  const mk = (p, a) => ({ player_id: p.id, player_name: p.name, amount: a })
  if (s1 === s2 && s2 === s3) return [mk(p1, 10), mk(p2, 10), mk(p3, 10)]
  if (s1 === s2 && s2 !== s3) return [mk(p1, 12.5), mk(p2, 12.5), mk(p3, 5)]
  if (s1 !== s2 && s2 === s3) return [mk(p1, 15), mk(p2, 7.5), mk(p3, 7.5)]
  return [mk(p1, 15), mk(p2, 10), mk(p3, 5)]
}

// 与 SQL 的 ORDER BY total_score DESC 一致：第一名在前
const standingsOf = (scores) => scores.slice().sort((a, b) => b - a)
  .map((s, i) => ({ id: i + 1, name: `P${i + 1}`, total_score: s, survival_count: 0 }))

const cents = (x) => Math.round(x * 100)

let failed = 0

// 断言一：总额恒为 30 元（按分计，不受浮点影响）
// 断言二：同一个并列组内，各人金额最多差 1 分（除不尽的尾数）
// 断言三：没有负数
function check(label, scores, expectTotal = 30) {
  const standings = standingsOf(scores)
  const fines = calculateBottomThreeFines(standings)
  const problems = []

  const total = fines.reduce((a, f) => a + cents(f.amount), 0)
  if (total !== cents(expectTotal)) problems.push(`总额 ${total / 100} 元 ≠ ${expectTotal} 元`)

  const byScore = new Map()
  for (const f of fines) {
    const sc = standings.find((s) => s.id === f.player_id).total_score
    if (!byScore.has(sc)) byScore.set(sc, [])
    byScore.get(sc).push(cents(f.amount))
  }
  for (const [sc, amts] of byScore) {
    if (Math.max(...amts) - Math.min(...amts) > 1) {
      problems.push(`${sc} 分这组金额不一致：${amts.map((a) => a / 100).join(' / ')}`)
    }
  }
  if (fines.some((f) => f.amount < 0)) problems.push('出现负数')

  if (problems.length) { failed++; console.log(`  ✗ ${label} → ${problems.join('；')}`) }
  else console.log(`  ✓ ${label.padEnd(30)} → ${fines.map((f) => f.amount).join(' / ')}`)
}

console.log('=== 并列组跨越末三位边界 ===')
check('并列倒数第三', [3, 8, 12, 12, 20])
check('后两同分 + 界外同分', [5, 5, 12, 12, 20])
check('倒数二三同分 + 界外同分', [3, 8, 8, 8, 20])
check('四人并列垫底', [5, 5, 5, 5, 20])
check('全不同分（对照）', [3, 8, 12, 16, 20])

console.log('\n=== ADR 0004 原有的三种同分 ===')
check('三者同分', [5, 5, 5, 20])
check('后两者同分', [5, 5, 12, 20])
check('前两者同分', [3, 8, 8, 20])

console.log('\n=== 除不尽与人数极值 ===')
check('五人全同分', [5, 5, 5, 5, 5])
check('七人全同分（30/7）', [5, 5, 5, 5, 5, 5, 5])
check('七人 15/7', [3, 8, 8, 8, 8, 8, 8, 20])
check('三人赛季', [3, 8, 12])
check('十人全同分', Array(10).fill(5))
check('不足三人无罚金', [3, 8], 0)

console.log('\n=== 与旧实现对照：不跨界的输入必须逐分一致 ===')
// 只有「并列组一半在窗口内、一半在窗口外」这一种情形才可能新旧不同。
// 组完全在窗口内（ADR 0004 的三种情况）或完全在窗口外，两边都必须给出一样的结果，
// 所以这些输入**不能**跳过，跳过就等于放掉了回归覆盖。
function straddles(scores) {
  const asc = scores.slice().sort((a, b) => a - b)
  let i = 0
  while (i < asc.length) {
    let j = i
    while (j < asc.length && asc[j] === asc[i]) j++
    if (j - i > 1 && i < 3 && j > 3) return true
    i = j
  }
  return false
}

const POOL = [3, 5, 8, 12, 16]
function* combos(n, acc = []) {
  if (acc.length === n) { yield acc; return }
  for (const v of POOL) yield* combos(n, [...acc, v])
}

let compared = 0
let mismatched = 0
for (let n = 3; n <= 5; n++) {
  for (const c of combos(n)) {
    if (straddles(c)) continue
    const a = calculateBottomThreeFines(standingsOf(c)).map((f) => cents(f.amount)).sort((x, y) => x - y)
    const b = oldFines(standingsOf(c)).map((f) => cents(f.amount)).sort((x, y) => x - y)
    compared++
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      mismatched++
      if (mismatched <= 5) console.log(`  ✗ ${c} 新=${a.map((x) => x / 100)} 旧=${b.map((x) => x / 100)}`)
    }
  }
}
if (mismatched) failed++
console.log(`  对照 ${compared} 组，不一致 ${mismatched} 组 ${mismatched ? '✗' : '✓'}`)

console.log(`\n${failed ? `失败 ${failed} 项` : '全部通过'}`)
process.exit(failed ? 1 : 0)
