-- 录入幂等键（配合 worker/src/index.js 的 POST /api/match 与
-- react-app/src/pages/MatchPage.jsx 的 client_token）。
--
-- 前端每次打开录入弹窗生成一个 token，连点 / 网络重试 / 请求在途时刷新都带着
-- 同一个值回来。后端先按 (season_id, client_token) 查已有局，命中就直接返回，
-- 不再插入第二遍；并发窗口由唯一索引兜住。
--
-- 用**部分索引**：历史行 client_token 为 NULL，不进索引，旧数据完全不受影响。
-- 已跑过本迁移的库重复执行时，第一行会报 duplicate column name（SQLite 的
-- ALTER TABLE ADD COLUMN 不支持 IF NOT EXISTS），属预期；第二行有 IF NOT EXISTS
-- 保护。按编号只跑一次即可。

ALTER TABLE matches ADD COLUMN client_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_client_token
  ON matches(season_id, client_token)
 WHERE client_token IS NOT NULL;
