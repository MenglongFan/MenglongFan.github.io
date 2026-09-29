#!/usr/bin/env node
// 捐赠称谓测试：node worker/test/donations.test.mjs
//
// 用 splice.mjs 把 donationTitle 与档位表从源码里切出来跑（理由见那个文件）。
// 锚点：`const DONATION_TITLES` 与「赛季状态机」那行分隔注释。
//
// 这一层测的是**档位边界**：称谓是「累计捐赠额」的纯派生量，档位错一格，
// 榜上就会给一个捐了 19 元的人挂上 50 元才该有的名号 —— 而且没人会立刻发现。
// 无依赖、毫秒级、边界值可以穷举，所以这类逻辑就该在这一层测。

import { spliceFunction } from './splice.mjs'

const SLICE = {
  from: 'const DONATION_TITLES',
  to: '// ---------- 赛季状态机 ----------',
  label: 'src/index.js',
}
const donationTitle = spliceFunction({ ...SLICE, fn: 'donationTitle' })
const DONATION_TITLES = spliceFunction({ ...SLICE, fn: 'DONATION_TITLES' })
const hasAtMostTwoDecimals = spliceFunction({ ...SLICE, fn: 'hasAtMostTwoDecimals' })

let failed = 0
const fail = (msg) => { failed++; console.log(`  ✗ ${msg}`) }

// ---------- 一、档位边界 ----------
// 每对都是「档位门槛两侧」：门槛减一分钱必须还是上一档，门槛本身必须进这一档。
console.log('=== 档位边界（判据是 >=，恰好到门槛即达标）===')
const CASES = [
  [0, ''],
  [4.99, ''],
  [5, '解囊相助'],
  [19.99, '解囊相助'],
  [20, '仗义疏财'],
  [49.99, '仗义疏财'],
  [50, '乐善好施'],
  [99.99, '乐善好施'],
  [100, '义薄云天'],
  [1000, '义薄云天'],
]
for (const [amount, expect] of CASES) {
  const got = donationTitle(amount)
  if (got === expect) {
    console.log(`  ✓ ${String(amount).padStart(7)} 元 → ${got || '（无称谓）'}`)
  } else {
    fail(`${amount} 元 → 得到「${got}」，期望「${expect || '（无称谓）'}」`)
  }
}

// ---------- 二、异常输入不崩 ----------
console.log('\n=== 异常输入 ===')
for (const [amount, label] of [[-1, '负数'], [-0.01, '负的小额'], [1e9, '十亿']]) {
  let got
  try {
    got = donationTitle(amount)
  } catch (e) {
    fail(`${label}（${amount}）抛异常：${e.message}`)
    continue
  }
  const ok = amount < 0 ? got === '' : got === '义薄云天'
  if (ok) console.log(`  ✓ ${label.padEnd(6)} → ${got || '（无称谓）'}`)
  else fail(`${label}（${amount}）→ 得到「${got}」`)
}

// ---------- 三、档位表本身的不变式 ----------
// 这组断言防的是「改表时改坏」：donationTitle 是一路 for 下来取第一个命中的，
// 所以表一旦不是按门槛降序排，就会返回低档 —— 结果是「捐得越多名号越小」，
// 而且只在那个人跨过两档时才会显形。
console.log('\n=== 档位表不变式 ===')
const mins = DONATION_TITLES.map((t) => t.min)
const descending = mins.every((m, i) => i === 0 || mins[i - 1] > m)
if (descending) console.log(`  ✓ 按门槛降序排列（${mins.join(' > ')}）`)
else fail(`档位表没有按门槛降序：${mins.join(' / ')} —— donationTitle 会返回低档`)

const allTitled = DONATION_TITLES.every((t) => typeof t.title === 'string' && t.title.length > 0)
if (allTitled) console.log('  ✓ 每一档都有非空称谓')
else fail('存在没有称谓的档位')

const allPositive = DONATION_TITLES.every((t) => t.min > 0)
if (allPositive) console.log('  ✓ 门槛都为正数')
else fail('存在非正数门槛 —— 0 元会被授予称谓')

// 最低门槛必须低于一次末位罚金（15 元），否则「捐了就有名分」不成立：
// 捐得比罚金还少的人拿不到任何称谓，门槛就失去了鼓励的意义。
const LOWEST = Math.min(...mins)
if (LOWEST <= 15) console.log(`  ✓ 最低门槛 ${LOWEST} 元 ≤ 一次末位罚金 15 元`)
else fail(`最低门槛 ${LOWEST} 元高于一次末位罚金 15 元，「捐了就有名分」不成立`)

// ---------- 四、单调性：累计额只增不减，称谓只能升不能降 ----------
// 榜单是按累计额排的，如果称谓随金额不是单调的，榜上就会出现「金额更高但名号更低」的相邻两行。
console.log('\n=== 单调性（金额越大，档位只能越高）===')
let lastTier = -1
let monotonic = true
for (let amt = 0; amt <= 200; amt += 0.5) {
  const tier = DONATION_TITLES.findIndex((t) => amt >= t.min)
  // findIndex 未命中返回 -1，归一成「无档」= 最低位
  const rank = tier === -1 ? -1 : DONATION_TITLES.length - 1 - tier
  if (rank < lastTier) { monotonic = false; fail(`金额 ${amt} 元时档位回退（${lastTier} → ${rank}）`); break }
  lastTier = rank
}
if (monotonic) console.log('  ✓ 0 到 200 元之间（步长 0.5）档位单调不降')

// ---------- 五、金额的「最多两位小数」判据 ----------
// 这一组是有来历的：原来的实现写成 `Math.round(a * 100) !== a * 100`，
// 也就是拿浮点数做精确相等。0.29 * 100 === 28.999999999999996，于是 0.29 元
// 被当成「超过两位小数」拒掉 —— 实测 0.01~100.00 这一万个合法两位小数里
// 有 1146 个（11.5%）会被误拒。沙盒状态机跑第一遍就撞上了（19.99 被拒）。
console.log('\n=== 金额两位小数判据 ===')
for (const v of [0.01, 0.29, 1.1, 2.2, 5, 19.99, 49.99, 99.99, 100, 175.55]) {
  if (hasAtMostTwoDecimals(v)) console.log(`  ✓ ${String(v).padStart(7)} 是合法两位小数`)
  else fail(`${v} 被误判为「超过两位小数」`)
}
for (const v of [1.234, 0.001, 1.005, 10.123, 0.0001]) {
  if (!hasAtMostTwoDecimals(v)) console.log(`  ✓ ${String(v).padStart(7)} 被正确拒绝`)
  else fail(`${v} 是三位以上小数，却通过了校验`)
}

// 穷举：0.01 ~ 100.00 的每一个合法两位小数都必须通过。
// 单独挑几个例子是不够的 —— 原实现恰恰是「大部分值能过」，只有 11.5% 漏网，
// 随手挑几个很容易全挑到能过的那些，然后误以为没问题。
let wronglyRejected = 0
for (let c = 1; c <= 10000; c++) {
  if (!hasAtMostTwoDecimals(c / 100)) wronglyRejected++
}
if (wronglyRejected === 0) console.log('  ✓ 穷举 0.01~100.00 全部 10000 个两位小数，无一误拒')
else fail(`穷举 0.01~100.00：有 ${wronglyRejected} 个合法两位小数被误拒`)

console.log(`\n${failed ? `失败 ${failed} 项` : '全部通过'}`)
process.exit(failed ? 1 : 0)
