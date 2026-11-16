# ADR 0015: 录入幂等 — client_token + 前端提交锁

**状态**: 已接受（前端上线、migration-006、Worker 部署、线上清库均已完成 · 2026-11-16 14:33）
**日期**: 2026-11-16

## 背景

「7 人赛季三番战」清空数据时出现卡顿，房主在请求无反馈的情况下连点提交，
同一局被录入多次。排查结论：

- 前端 `react-app/src/pages/MatchPage.jsx` 的 `handleSubmit` 没有 in-flight 锁，
  页脚「提交」按钮无 disabled、无进行中反馈。
- 后端 `worker/src/index.js` 的 `POST /api/match` 每次请求直接
  `INSERT INTO matches` + `batch(match_results)`，**没有任何幂等键**。
- `env.DB.batch()` 偶发慢，请求在途时间越长，连点概率越高。

卡顿是诱因，缺少幂等才是根因。仅加前端锁挡不住网络重试、多标签与请求重放。

## 决策

三层防护，逐层收口：

1. **前端提交锁**：`submittingRef` 同步锁（不用 state —— state 要等下一帧，
   挡不住同一轮事件里的连点）；`setBusy()` 按 `id` 直接改 DOM 的 disabled / 文案
   （页脚 JSX 经 `setModalContent` 传入后会被冻住，不能用 React state 控 disabled，
   见 `SeasonPage.jsx` 同款踩坑记录）。失败才解锁允许重试。
2. **客户端幂等键**：每次**打开录入弹窗**（组件挂载）生成一次 `client_token`，
   随 `POST /api/match` 提交；连点 / 失败重试复用同一个值。
   弹窗重开 = 新 token，保证「另打一局」不会被误判成重复提交。
3. **服务端唯一约束 + 幂等返回**：`migration-006` 给 `matches` 加 `client_token`
   与部分唯一索引 `(season_id, client_token) WHERE client_token IS NOT NULL`。
   提交前按 token 查已有局，命中直接返回该局（响应结构与首次提交一致，额外带
   `duplicate: true`）；并发窗口由唯一索引兜住，INSERT 抛错后回查返回；
   明细批写失败则撤掉刚插的对局行，避免留下 `rows_n < player_count` 的半截局。

## 理由

- **不用「N 秒内重复请求去重」**：合法的两局完全可能在很短时间内有相同的
  `player_count` 与分数分布，时间窗会误杀。幂等键由一次逻辑提交显式携带，语义明确。
- **用部分索引而非全列唯一**：历史行 `client_token` 为 NULL，不进索引，
  旧数据无需回填，也不影响 ADR 0003「历史对局不重算、不补录」。
- **token 按弹窗生命周期而非会话持久化**：按 session 持久会导致「关掉弹窗、
  再开一局」复用旧 token，第二局被错误吞掉。按挂载生成才符合「一次录入 = 一个 token」。
- **后端保留向下兼容**：`client_token` 缺省时走原路径，旧前端 / 旧 Worker 混跑
  不会因为多一个字段而失败。只推前端是安全的降级状态（前端锁生效、后端幂等未生效）。

## 后果

- **部署顺序不可调换**：必须先 `wrangler d1 execute ... --file=migration-006-...sql --remote`
  再 `wrangler deploy`。新 Worker 的 INSERT 写入 `client_token` 列，列不存在时录入会 500。
- 补齐后，连点 / 网络重试 / 并发重复请求都只产生一局；`duplicate: true` 可用于观测命中率。
- 业务计算仍只在 Worker 一处（`calculateScores`），幂等命中返回库中已算好的结果，
  不引入第二份算分实现，不违反 `docs/agents/domain.md` 的单一计算权威约束。
- 已结算赛季（`status = 'ended'`）仍在校验前置拦截，幂等返回不会绕过赛季状态检查。

## 相关

- ADR 0003（赛季结束不可变）、ADR 0012（首亮加分）、ADR 0013（击杀加分）均无冲突。
- 数据清理脚本 `worker/cleanup-season-sanfanzhan.sql`：只清该赛季战绩，保留赛季壳、
  参赛名单与全部奖池流水，不触碰余额链。
