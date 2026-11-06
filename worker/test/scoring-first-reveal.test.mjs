#!/usr/bin/env node
// 积分公式 + 首亮加分测试：node worker/test/scoring-first-reveal.test.mjs
//
// 用 splice.mjs 把 calculateScores 从源码里切出来跑（为什么是「切」而不是 import
// 或在测试里重写一份，见那个文件）。两个锚点：'// 积分公式：存活者得' 与
// '// 积分榜总名次：'，它们一旦消失或顺序颠倒就报错退出，而不是静默跳过。
//
// 既有 3 个单测（fines / donations / standings-rank）没有一个覆盖算分函数，
// 这是第一个。纯函数单测，不起服务、不碰数据库、不读配置。

import { readFileSync } from 'node:fs'
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

// ids 按录入页的拖拽顺序给 rank（i+1）：越靠前 rank 越小、死者得分越高。
// 后端 dead.sort(rank) 后依次给 D, D-1 … 1，与前端 deadList.indexOf(r) 同序。
function match(ids, survivors, firstReveal = null) {
  const rows = ids.map((id, i) => ({
    player_id: id,
    rank: i + 1,
    is_survivor: survivors.includes(id) ? 1 : 0,
  }))
  const scored = calculateScores(rows, firstReveal)
  return ids.map(id => scored.find(r => r.player_id === id).score)
}

const eight = [1, 2, 3, 4, 5, 6, 7, 8]
const five = [1, 2, 3, 4, 5]

// ---- ADR 0002 基线：加分不能动原有公式 ----
eq('8 人局 5 死 3 活 · 无首亮', match(eight, [1, 2, 3]), [6, 6, 6, 5, 4, 3, 2, 1])

// ---- 首亮加分（ADR 0012）----
eq('首亮者是存活者 → 独占第一', match(eight, [1, 2, 3], 1), [7, 6, 6, 5, 4, 3, 2, 1])
eq('首亮者是拿 4 分的死者', match(eight, [1, 2, 3], 5), [6, 6, 6, 5, 5, 3, 2, 1])
eq('首亮者是最低分死者 → 1+1，不越界', match(eight, [1, 2, 3], 8), [6, 6, 6, 5, 4, 3, 2, 2])

// ADR 0012 里写明的那个场景：淘汰者与存活者并列第一，名次派生会跟着重排。
eq('5 人局 4 死 1 活 · 首亮者为最高分死者 → 5,5,3,2,1',
  match(five, [1], 2), [5, 5, 3, 2, 1])

// ---- 两个极端局：覆盖前后端公式统一前的分叉分支 ----
eq('全员存活 D=0 · 无首亮', match(five, five), [1, 1, 1, 1, 1])
eq('全员存活 D=0 · 首亮 +1', match(five, five, 3), [1, 1, 2, 1, 1])
eq('全员淘汰 · 无首亮', match(five, []), [5, 4, 3, 2, 1])
eq('全员淘汰 · 首亮者得 D+1', match(five, [], 1), [6, 4, 3, 2, 1])

// ---- 不指定 / 非法 id：一律不加分 ----
eq('firstReveal = null', match(five, [1], null), [5, 4, 3, 2, 1])
eq('firstReveal 缺省（第二参数不传）', match(five, [1], undefined), [5, 4, 3, 2, 1])
eq('首亮 id 不在本局名单 → 不加分（接口层另有 400 校验）', match(five, [1], 99), [5, 4, 3, 2, 1])
eq('首亮 id 传字符串也能命中', match(five, [1], '3'), [5, 4, 3 + 1, 2, 1])

// ---- 函数只给每行补 score，不动行数与其它字段 ----
const rows = five.map((id, i) => ({ player_id: id, rank: i + 1, is_survivor: id === 1 ? 1 : 0 }))
const out = calculateScores(rows, 2)
ok('返回同一数组、行数不变', out === rows && out.length === 5)
eq('保留 player_id / rank / is_survivor',
  out.map(r => [r.player_id, r.rank, r.is_survivor]),
  [[1, 1, 1], [2, 2, 0], [3, 3, 0], [4, 4, 0], [5, 5, 0]])

// ---- 源码守卫 ----
// 算分有两份实现（worker 与 MatchPage 的分数预览），接口还有一条写入路径。
// 纯函数测绿了但线上没接上，或前端公式又分叉了，都会静默溜过去 —— 这里盯住。
const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8')
const jsx = readFileSync(new URL('../../react-app/src/pages/MatchPage.jsx', import.meta.url), 'utf8')
const handler = src.slice(src.indexOf('// POST /api/match'), src.indexOf('// GET /api/prize-pool/summary'))

ok('算分函数确实给首亮者 +1', /first\.score\s*\+=\s*1/.test(src))
ok('/api/match 把首亮 id 传进算分函数', handler.includes('calculateScores(results, firstRevealId)'))
ok('/api/match 校验首亮 id 在本局名单内', handler.includes('首亮玩家不在本局参赛名单内'))
// 只比请求体自带的 results 不算数：手改请求就能绕过，到 INSERT 撞外键变成 500。
ok('/api/match 用 season_players 核实首亮 id（服务端真相，防请求体伪造）',
  /SELECT 1 FROM season_players/.test(handler))
ok('首亮校验排在赛季状态检查之后（无效赛季仍先报 404）',
  handler.indexOf('赛季不存在') < handler.indexOf('SELECT 1 FROM season_players'))
ok('/api/match 把首亮 id 写进 matches',
  /INSERT INTO matches \([^)]*first_reveal_player_id/.test(handler))
ok('前端 topScore 与后端同式（不再有 survivors > 0 三元分叉）',
  jsx.includes('const topScore = dead + 1') && !jsx.includes('survivors > 0 ? dead + 1 : dead'))
ok('前端预览含首亮 +1', jsx.includes('r.player_id === firstRevealId ? base + 1 : base'))
ok('前端提交体带上首亮 id', jsx.includes('first_reveal_player_id: firstRevealId'))
ok('拖拽排除新按钮（否则点「亮」会起拖）',
  jsx.includes(".closest('.sort-toggle, .sort-reveal')"))

// ---- 逐局明细的「亮」印章（ADR 0012 后补）----
// 三处明细共用 /api/player/:id/details。纯函数测不到 SQL 有没有把标记派生出来，
// 而漏了它前端三枚印章就永远不亮 —— 用源码守卫盯住。
const detailHandler = src.slice(
  src.indexOf('// GET /api/player/:id/details'),
  src.indexOf('// POST /api/match')
)
ok('/api/player/:id/details 派生 is_first_reveal 供三处明细使用',
  /CASE WHEN m\.first_reveal_player_id = mr\.player_id[\s\S]*?AS is_first_reveal/.test(detailHandler))
ok('历史对局（首亮列为 NULL）走 ELSE 0，不会被误标',
  /THEN 1 ELSE 0 END AS is_first_reveal/.test(detailHandler))

const standingsJsx = readFileSync(new URL('../../react-app/src/pages/StandingsPage.jsx', import.meta.url), 'utf8')
const seasonJsx = readFileSync(new URL('../../react-app/src/pages/SeasonPage.jsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../../react-app/src/styles/global.css', import.meta.url), 'utf8')
ok('三处明细都渲染「亮」印章（积分榜 1 处 + 赛季页 2 处）',
  /stamp reveal/.test(standingsJsx) && (seasonJsx.match(/stamp reveal/g) || []).length >= 2)
ok('积分榜明细用 .d-top 打包两枚章（窄屏不竖排成三行）',
  /className="d-top"/.test(standingsJsx))
ok('.stamp.reveal 配色同时覆盖 detail-row 与 match-row',
  /\.detail-row \.stamp\.reveal,/.test(css) && /\.match-row \.stamp\.reveal\{/.test(css))

if (failed) { console.error(`\n${failed} 项失败`); process.exit(1) }
console.log('\n全部通过')
