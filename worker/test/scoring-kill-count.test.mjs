#!/usr/bin/env node
// 击杀加分（ADR 0013）：node worker/test/scoring-kill-count.test.mjs
//
// 与 scoring-first-reveal.test.mjs 共用 splice.mjs 的两个锚点，把 calculateScores
// 从源码里切出来跑。纯函数单测 + 源码守卫：不起服务、不碰数据库、不读配置。
// 源码守卫盯的是「纯函数测绿了但线上没接上」这类静默漏接：严格校验、落库列、
// 前后端两份算分实现、按键接线，都在这里各有一条。

import { readFileSync, existsSync } from 'node:fs'
import { spliceFunction } from './splice.mjs'

const calculateScores = spliceFunction({
  from: '// 积分公式：存活者得',
  to: '// 积分榜总名次：',
  fn: 'calculateScores',
  label: 'src/index.js',
})

let failed = 0
function eq(label, got, want) {
  const a = JSON.stringify(got), b = JSON.stringify(want)
  if (a === b) console.log(`PASS ${label}`)
  else { console.error(`FAIL ${label}\n  得到 ${a}\n  期望 ${b}`); failed++ }
}
function ok(label, cond) {
  if (cond) console.log(`PASS ${label}`)
  else { console.error(`FAIL ${label}`); failed++ }
}

// ids 按录入页的拖拽顺序给 rank（i+1）。kills 是 {player_id: 击杀数}。
function match(ids, survivors, kills = {}, firstReveal = null) {
  const rows = ids.map((id, i) => ({
    player_id: id,
    rank: i + 1,
    is_survivor: survivors.includes(id) ? 1 : 0,
    ...(kills[id] !== undefined ? { kill_count: kills[id] } : {}),
  }))
  const scored = calculateScores(rows, firstReveal)
  return ids.map(id => scored.find(r => r.player_id === id).score)
}

const eight = [1, 2, 3, 4, 5, 6, 7, 8]
const five = [1, 2, 3, 4, 5]

// ---- 基线：不带 kill_count 时，ADR 0002 / 0012 的分数一分不动 ----
eq('8 人局 5 死 3 活 · 无击杀', match(eight, [1, 2, 3]), [6, 6, 6, 5, 4, 3, 2, 1])
eq('5 人局 4 死 1 活 · 无击杀', match(five, [1]), [5, 4, 3, 2, 1])
eq('首亮加分不被击杀分支干扰', match(five, [1], {}, 3), [5, 4, 4, 2, 1])

// ---- 击杀加分：每人头 +1，但额度是**全局**的（ADR 0013 修订）----
eq('一名死者 +1', match(five, [1], { 3: 1 }), [5, 4, 4, 2, 1])
eq('一名死者 +3（被淘汰者反超存活者）', match(five, [1], { 5: 3 }), [5, 4, 3, 2, 4])
eq('存活者也能拿击杀分', match(five, [1], { 1: 2 }), [7, 4, 3, 2, 1])
eq('额度可分给多人，合计不超 D', match(five, [1], { 1: 1, 4: 2 }), [6, 4, 3, 4, 1])
eq('额度可以全给一个人（不设逐人上限）', match(five, [1], { 3: 4 }), [5, 4, 7, 2, 1])
eq('超额请求按行顺序发放剩余额度（接口层另有 400）',
  match(five, [1], { 1: 3, 3: 3 }), [8, 4, 4, 2, 1])

// 用户举的反例：7 人场 6 死，全场只能记 6 次，绝不能每人各 6 次（旧实现会发出 42 次）。
const seven = [1, 2, 3, 4, 5, 6, 7]
eq('7 人场 6 死 · 全场额度只有 6 次',
  match(seven, [1], { 1: 6, 2: 6, 3: 6, 4: 6, 5: 6, 6: 6, 7: 6 }),
  [13, 6, 5, 4, 3, 2, 1])

// ---- 与首亮叠加（两项直接相加，顺序无关）----
eq('同一人既首亮又击杀 2 次', match(five, [1], { 1: 2 }, 1), [8, 4, 3, 2, 1])
eq('首亮与击杀落在不同人', match(five, [1], { 3: 2 }, 5), [5, 4, 5, 2, 2])

// ---- 极端局与上限 ----
eq('全员存活 D=0 · 无击杀', match(five, five), [1, 1, 1, 1, 1])
eq('全员存活 D=0 · 击杀被夹成 0', match(five, five, { 1: 3 }), [1, 1, 1, 1, 1])
eq('全员淘汰 D=5 · 满击杀', match(five, [], { 1: 5 }), [10, 4, 3, 2, 1])
eq('单个申报值超过剩余额度时也只发剩余额度', match(five, [1], { 1: 99 }), [9, 4, 3, 2, 1])

// ---- 非法值防御：宁可不加分，也不能把 score 变成 NaN 或字符串拼接 ----
for (const [label, bad] of [
  ['undefined', undefined], ['null', null], ['字符串 "3"', '3'],
  ['小数 1.5', 1.5], ['负数 -2', -2], ['NaN', NaN], ['布尔 true', true],
]) {
  const rows = five.map((id, i) => ({
    player_id: id, rank: i + 1, is_survivor: id === 1 ? 1 : 0,
    kill_count: bad,
  }))
  eq(`非法 kill_count = ${label} 一律不加分`,
    calculateScores(rows).map(r => r.score), [5, 4, 3, 2, 1])
}

// ---- 函数只补 score，不动行数与其它字段 ----
const rows = five.map((id, i) => ({
  player_id: id, rank: i + 1, is_survivor: id === 1 ? 1 : 0, kill_count: i === 2 ? 2 : 0,
}))
const out = calculateScores(rows, 2)
ok('返回同一数组、行数不变', out === rows && out.length === 5)
eq('保留 player_id / rank / is_survivor / kill_count',
  out.map(r => [r.player_id, r.rank, r.is_survivor, r.kill_count]),
  [[1, 1, 1, 0], [2, 2, 0, 0], [3, 3, 0, 2], [4, 4, 0, 0], [5, 5, 0, 0]])

// ---- 源码守卫 ----
const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8')
const jsx = readFileSync(new URL('../../react-app/src/pages/MatchPage.jsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../../react-app/src/styles/global.css', import.meta.url), 'utf8')
const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
const handler = src.slice(src.indexOf('// POST /api/match'), src.indexOf('// GET /api/prize-pool/summary'))

ok('算分函数按每人击杀数加分', /r\.score\s*\+=\s*k/.test(src))
ok('算分函数按全局额度发放，不是逐人封顶',
  /let killBudget = D/.test(src) &&
  /Math\.min\(r\.kill_count,\s*killBudget\)/.test(src) && /killBudget -= k/.test(src))
ok('/api/match 严格判整数（字符串不转换）', handler.includes('Number.isInteger(k)'))
ok('/api/match 上限取本局淘汰人数 D', /const D = results\.filter\(r => r\.is_survivor === 0\)\.length/.test(handler))
ok('/api/match 逐人只校验非负整数（不再逐人封顶）',
  /!Number\.isInteger\(k\) \|\| k < 0/.test(handler) && !/k > D/.test(handler))
ok('/api/match 按全场合计校验额度',
  /let killTotal = 0/.test(handler) && /killTotal \+= k/.test(handler) && /killTotal > D/.test(handler))
ok('/api/match 超额时报出合计与淘汰人数', handler.includes('超过淘汰人数'))
ok('/api/match 缺省/null 当 0（旧前端仍可提交）', handler.includes('r.kill_count == null ? 0 : r.kill_count'))
ok('/api/match 把击杀数写进 match_results',
  /INSERT INTO match_results \([^)]*kill_count/.test(handler) && handler.includes('r.kill_count)'))
ok('schema.sql 有 kill_count 列', /kill_count\s+INTEGER/.test(schema))

const migrationPath = new URL('../migration-005-kill-count.sql', import.meta.url)
ok('migration-005 存在', existsSync(migrationPath))
if (existsSync(migrationPath)) {
  const migration = readFileSync(migrationPath, 'utf8')
  ok('migration-005 给 match_results 加可空列',
    /ALTER TABLE match_results ADD COLUMN kill_count INTEGER;/.test(migration))
  // 注释里会写「不要写 UPDATE 回填」「不要写 DEFAULT 0」，得只看可执行 SQL。
  const sqlOnly = migration.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  ok('migration-005 不回填历史（可执行 SQL 里没有 UPDATE / DEFAULT 0）',
    !/UPDATE\s+match_results/i.test(sqlOnly) && !/DEFAULT\s+0/i.test(sqlOnly))
}

ok('前端预览同步加击杀分（两份算分实现一致）', /withReveal \+ r\.kill_count/.test(jsx))
ok('前端提交体带逐人 kill_count', jsx.includes('kill_count: r.kill_count,'))
ok('每个玩家一枚击杀按键', /className=\{`kill-add/.test(jsx) && jsx.includes('onClick={() => addKill(r.player_id)}'))
ok('击杀按键按一次 +1', /kill_count: r\.kill_count \+ 1/.test(jsx))
ok('有值时给「−」回退一次', /onClick=\{\(\) => removeKill\(r\.player_id\)\}/.test(jsx))
ok('前端按全场合计计算剩余额度',
  /const killUsed = order\.reduce/.test(jsx) && /const killLeft = Math\.max\(0, dead - killUsed\)/.test(jsx))
ok('前端额度用尽时禁用所有「杀」', /disabled=\{dead === 0 \|\| killLeft === 0\}/.test(jsx))
ok('前端不再有逐人上限', !/r\.kill_count >= dead/.test(jsx) && !/r\.kill_count < dead/.test(jsx))
ok('前端显示全场额度 X / D', jsx.includes('kill-budget') && /\.kill-budget\{/.test(css))
ok('切换存/亡按全局超额逐个回退',
  /let over = /.test(jsx) && /trimmed\[pick\]\.kill_count -= 1/.test(jsx))
ok('提示文案写明「全场合计上限」', jsx.includes('全场合计上限'))
ok('没有退回手动数字输入框', !/type=["']number["']/.test(jsx))
ok('击杀控件在分数预览区、不在拖拽行',
  jsx.indexOf('score-preview-grid') < jsx.indexOf('kill-ctrl'))
ok('拖拽排除名单未被改动', jsx.includes(".closest('.sort-toggle, .sort-reveal')"))
ok('击杀控件有样式', /\.kill-ctrl\{/.test(css) && /\.kill-ctrl \.kill-add/.test(css))

if (failed) { console.error(`\n${failed} 项失败`); process.exit(1) }
console.log('\n全部通过')
