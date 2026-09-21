-- ============================================================================
-- 清理测试数据：只保留「5 人赛季」(seasons.id = 7)
-- ============================================================================
-- 赛季 4 / 5 / 6 以及奖池里对应的流水都是开发期测试数据，本脚本把它们删掉。
--
-- 目标终态
--   seasons                    1 行   (id=7)
--   matches                    5 行   (id 18..22)
--   match_results             25 行   (5 局 × 5 人)
--   season_players             5 行   (season_id=7)
--   prize_pool_transactions    3 行   (id 9/10/11)
--   奖池余额                    30     (齐济 5 + 肇淘胜 10 + 范昊宇 15)
--
-- 两个容易踩的坑，动手前请先读：
--
--  1) schema 里没有 ON DELETE CASCADE（SQLite 默认也不启用外键），
--     所以必须「子表先删」：match_results → matches → season_players
--     → prize_pool_transactions → seasons。顺序不能调换，否则会留下孤儿行。
--
--  2) 奖池余额不是 SUM(amount)，而是「id 最大那一行的 balance 字段」
--     （见 worker/src/index.js 的 getCurrentBalance）。
--     所以只删流水是不够的：删完之后 id=11 那行仍写着 balance=60，
--     界面上余额会继续显示 60。必须一并修正，见第 3 步。
--
-- 执行方式
--   Cloudflare 控制台：Workers & Pages → D1 → guozhan-scoring → Console，整段粘贴
--   命令行：npx wrangler d1 execute guozhan-scoring --remote --file=worker/cleanup-test-data.sql
-- ============================================================================


-- ---------- 第 0 步：备份 ----------
-- 先把下面 5 条的结果复制到本地存好，再执行第 2 步。
-- 删完就找不回来了，这一步别跳。
SELECT 'seasons'                  AS tbl, * FROM seasons;
SELECT 'matches'                  AS tbl, * FROM matches;
SELECT 'match_results'            AS tbl, * FROM match_results;
SELECT 'season_players'           AS tbl, * FROM season_players;
SELECT 'prize_pool_transactions'  AS tbl, * FROM prize_pool_transactions;


-- ---------- 第 1 步：执行前核对 ----------
-- 期望值：待删 matches=13、match_results=91、season_players=7、流水=8；保留流水=3
-- 对不上就先停下来，说明数据和写这份脚本时不一样了。
SELECT
  (SELECT COUNT(*) FROM matches
    WHERE season_id IN (4,5,6))                                   AS "待删 matches",
  (SELECT COUNT(*) FROM match_results
    WHERE match_id IN (SELECT id FROM matches WHERE season_id IN (4,5,6)))
                                                                  AS "待删 match_results",
  (SELECT COUNT(*) FROM season_players
    WHERE season_id IN (4,5,6))                                   AS "待删 season_players",
  (SELECT COUNT(*) FROM prize_pool_transactions
    WHERE season_id IS NULL OR season_id <> 7)                    AS "待删 流水",
  (SELECT COUNT(*) FROM prize_pool_transactions
    WHERE season_id = 7)                                          AS "保留 流水";


-- ---------- 第 2 步：删除（顺序不可调换） ----------

-- 2.1 先删对局结果（引用 match_id）
DELETE FROM match_results
 WHERE match_id IN (SELECT id FROM matches WHERE season_id IN (4,5,6));

-- 2.2 再删对局
DELETE FROM matches
 WHERE season_id IN (4,5,6);

-- 2.3 删赛季选手关联
DELETE FROM season_players
 WHERE season_id IN (4,5,6);

-- 2.4 删奖池流水：只留「5 人赛季」的
--     season_id IS NULL 的那两条是测试期的「支取奖池」，一并删掉
DELETE FROM prize_pool_transactions
 WHERE season_id IS NULL OR season_id <> 7;

-- 2.5 最后删赛季本身
DELETE FROM seasons
 WHERE id IN (4,5,6);


-- ---------- 第 3 步：修正奖池余额 ----------
-- 这三行的 balance 记的是「这一笔之后奖池有多少钱」。删掉它们之前的历史后，
-- 起点变成 0，所以要按 id 升序重算：15 → 25 → 30。
UPDATE prize_pool_transactions SET balance = 15 WHERE id = 9;   -- 范昊宇 +15
UPDATE prize_pool_transactions SET balance = 25 WHERE id = 10;  -- 肇淘胜 +10
UPDATE prize_pool_transactions SET balance = 30 WHERE id = 11;  -- 齐济   +5


-- ---------- 第 4 步：验证 ----------
-- 期望：seasons=1  matches=5  match_results=25  season_players=5  流水=3
SELECT 'seasons'                 AS tbl, COUNT(*) AS n FROM seasons
UNION ALL SELECT 'matches',                COUNT(*) FROM matches
UNION ALL SELECT 'match_results',          COUNT(*) FROM match_results
UNION ALL SELECT 'season_players',         COUNT(*) FROM season_players
UNION ALL SELECT 'prize_pool_transactions',COUNT(*) FROM prize_pool_transactions;

-- 期望：30
SELECT (SELECT balance FROM prize_pool_transactions ORDER BY id DESC LIMIT 1) AS "奖池余额";

-- 期望：3 行，齐济 5 / 肇淘胜 10 / 范昊宇 15，balance 依次 15 / 25 / 30
SELECT id, player_id, amount, balance, description FROM prize_pool_transactions ORDER BY id;

-- 期望：只剩 5 人赛季，且没有任何赛季处于进行中
SELECT id, name, is_active, started_at, ended_at FROM seasons;


-- ---------- 第 5 步（可选）：删除已无任何数据的选手 ----------
-- 清理后 李晓阳(id=4) 和 祝振军(id=7) 不再有任何对局与流水记录，
-- 只作为花名册里的名字存在（「5 人赛季」的参赛者是 1/2/3/5/6）。
--
-- 如果他们是真实成员、以后还会参赛，**不要执行这一段**。
-- 默认注释掉，需要时再手动放开（注意：注释里不写分号，避免干扰按分号切句的工具）。
--
-- DELETE FROM players WHERE id IN (4, 7)
