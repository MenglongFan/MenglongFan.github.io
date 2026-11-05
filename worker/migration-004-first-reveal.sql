-- migration-004: 首亮玩家（ADR 0012）
--
-- 背景：新增需求「一局中最先亮将的玩家积分 +1」，录入战绩时要有对应选项。
-- 首亮玩家是**局级**概念：亮将是有先后次序的动作，不可能两人同时率先亮将，
-- 所以一局至多一人，落在 matches 而不是 match_results。
--
-- 列可以为 NULL：表示「本局不指定首亮玩家、不加分」，是合法状态（房主可以不选）。
-- 加分本身不落列 —— 它直接并入 match_results.score，score 仍是唯一真值，
-- 总榜 SUM(score) 与三处逐局明细都不需要改。本列只作审计留底，
-- 不进任何读取接口，也不参与任何计算。
--
-- 历史对局：ADD COLUMN 后自动为 NULL，正好对应「只对新录入对局生效、
-- 历史不重算不补录」（ADR 0012 / ADR 0003 赛季结束后不可修改）。
-- **不要在这里写 UPDATE 回填**。
--
-- 幂等性：ADD COLUMN 重复执行会报 "duplicate column name"，属预期；本脚本只跑一次。
-- 顺序：schema.sql 是「当前结构」，全新库直接跑 schema.sql 即可，
-- 本脚本只用于已有库升级（见 worker/README.md 的迁移约定）。

ALTER TABLE matches ADD COLUMN first_reveal_player_id INTEGER REFERENCES players(id);
