#!/usr/bin/env node
// 积分榜名次测试：node worker/test/standings-rank.test.mjs
// 用 splice.mjs 把 assignStandingsRanks 从源码里切出来跑，测的就是线上那份实现。

import { readFileSync } from 'node:fs'
import { spliceFunction } from './splice.mjs'

const assignStandingsRanks = spliceFunction({
  from: '// 积分榜总名次',
  to: '// 末尾三名罚金计算（含同分平摊）',
  fn: 'assignStandingsRanks',
  label: 'src/index.js',
})

let failed = 0
function eq(label, got, want) {
  const a = JSON.stringify(got), b = JSON.stringify(want)
  if (a === b) console.log(`PASS ${label}`)
  else { console.error(`FAIL ${label}\n  得到 ${a}\n  期望 ${b}`); failed++ }
}

const row = (id, total_score, survival_count) => ({ id, name: `P${id}`, total_score, survival_count })
const ranksOf = (rows) => assignStandingsRanks(rows).map((r) => r.rank)

// 旧实现的等价 JS：并列判定同时看积分和存活次数（原 RANK() OVER 的 ORDER BY）。
function oldRanks(rows) {
  return rows.map((r, i) => 1 + rows.slice(0, i).filter((p) =>
    p.total_score > r.total_score ||
    (p.total_score === r.total_score && p.survival_count > r.survival_count)).length)
}

// 线上截图那组真实数据：34 / 29×3（存活 2,2,1）/ 26 / 21×2（存活 2,1）
const screenshot = [
  row(1, 34, 3), row(2, 29, 2), row(3, 29, 2), row(4, 29, 1),
  row(5, 26, 1), row(6, 21, 2), row(7, 21, 1),
]
eq('截图数据 → 1,2,2,2,5,6,6', ranksOf(screenshot), [1, 2, 2, 2, 5, 6, 6])
eq('旧实现确实给出 1,2,2,4,5,6,7（本测试能抓到这个回归）', oldRanks(screenshot), [1, 2, 2, 4, 5, 6, 7])

eq('无并列 → 1..n', ranksOf([row(1, 9, 3), row(2, 8, 1), row(3, 7, 0)]), [1, 2, 3])
eq('全员同分 → 全是 1', ranksOf([row(1, 5, 3), row(2, 5, 0), row(3, 5, 1)]), [1, 1, 1])
eq('空榜 → []', assignStandingsRanks([]), [])

// 返回新对象、不动入参、保留其它字段
const input = [row(1, 9, 2), row(2, 9, 1)]
const out = assignStandingsRanks(input)
eq('不修改入参', input.map((r) => 'rank' in r), [false, false])
eq('保留字段并补上 rank', out.map((r) => [r.id, r.name, r.survival_count, r.rank]),
  [[1, 'P1', 2, 1], [2, 'P2', 1, 1]])

// D1 的 SQL 路径没法在单测里跑，加一条源码守卫：/api/standings 必须真的接上，
// 否则「函数测绿了、线上还在用旧 RANK()」会静默溜过去。
const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8')
const handler = src.slice(src.indexOf('// GET /api/standings'), src.indexOf('// GET /api/players'))
// 正则只认带 `(` 的窗口函数调用，注释里那句「不再用 RANK() OVER ——」不算。
if (!handler.includes('assignStandingsRanks(results)') || /RANK\(\)\s*OVER\s*\(/.test(handler)) {
  console.error('FAIL /api/standings 未接入 assignStandingsRanks，或仍留有 RANK() OVER')
  failed++
} else console.log('PASS /api/standings 已接入派生函数，SQL 里无 RANK() OVER')

if (failed) { console.error(`\n${failed} 项失败`); process.exit(1) }
console.log('\n全部通过')
