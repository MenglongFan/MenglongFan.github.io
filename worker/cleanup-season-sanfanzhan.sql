-- ============================================================================
-- 清空「7 人赛季三番战」战绩数据（只清战绩，保留赛季壳）
-- ============================================================================
-- 本次范围（已确认）：
--   删：该赛季的全部 matches + match_results
--   留：seasons 行、season_players 参赛名单、其他赛季、players 花名册、
--       prize_pool_transactions 全部流水与奖池余额
--   结果：赛季仍在、状态不变、参赛名单不变，可直接接着录入新对局
--
-- ⚠️ 删除不可逆。务必按「第 0 步备份 → 第 1 步核对 → 第 2 步删除 → 第 3 步验证」
--    分段执行，不要在 D1 Console 里整段一次粘贴。
--
-- 执行：npx wrangler d1 execute guozhan-scoring --remote --file=worker/cleanup-season-sanfanzhan.sql
--       --remote 不能省，省了会静默写到本地空库。
--       没有 wrangler 时：Cloudflare 控制台 → Workers & Pages → D1 →
--       guozhan-scoring → Console，按步骤分段粘贴。
--
-- 赛季定位用 name LIKE '%三番战%'。若第 1.1 步查不到，把文中所有
--   (SELECT id FROM seasons WHERE name LIKE '%三番战%')
-- 换成实际赛季 id。
--
-- 已知坑（详见 worker/cleanup-test-data.sql）：
--  1) 无 ON DELETE CASCADE，必须子表先删：match_results → matches。
--  2) 奖池余额取 id 最大那行的 balance，不是 SUM(amount)。本脚本**不删任何流水**，
--     所以余额链不受影响，无需重算；第 3 步只做一致性校验。
-- ============================================================================


-- ---------- 第 0 步：备份（导出 / 复制保存，删完找不回来）----------
SELECT 'seasons'                  AS tbl, * FROM seasons;
SELECT 'matches'                  AS tbl, * FROM matches;
SELECT 'match_results'            AS tbl, * FROM match_results;
SELECT 'season_players'           AS tbl, * FROM season_players;
SELECT 'prize_pool_transactions'  AS tbl, * FROM prize_pool_transactions;


-- ---------- 第 1 步：核对（只读，先看输出再执行删除）----------

-- 1.1 目标赛季：必须只有 1 行。多于一说明 LIKE 命中了别的赛季，先改条件。
SELECT id, name, status, is_active, started_at, ended_at,
       (SELECT COUNT(*) FROM matches m WHERE m.season_id = s.id) AS match_count
  FROM seasons s
 WHERE name LIKE '%三番战%';

-- 1.2 逐局清单：确认这些就是要清掉的局（含连点造成的重复局、半截写入的局）。
--     rows_n ≠ player_count 就是半截写入；记下总行数，第 3 步好核对。
SELECT m.id, m.played_at, m.player_count, m.first_reveal_player_id,
       (SELECT COUNT(*)   FROM match_results r WHERE r.match_id = m.id) AS rows_n,
       (SELECT SUM(score) FROM match_results r WHERE r.match_id = m.id) AS total_score
  FROM matches m
 WHERE m.season_id IN (SELECT id FROM seasons WHERE name LIKE '%三番战%')
 ORDER BY m.id;

-- 1.3 删除前的全局快照，抄下来跟第 3 步对比
SELECT (SELECT COUNT(*) FROM matches)                  AS "全局对局数",
       (SELECT COUNT(*) FROM match_results)            AS "全局明细数",
       (SELECT COUNT(*) FROM seasons)                  AS "赛季数",
       (SELECT COUNT(*) FROM season_players)           AS "参赛名单数",
       (SELECT COUNT(*) FROM prize_pool_transactions)  AS "流水数";

-- 1.4 该赛季是否结算过罚金。有结果只说明它已结束过，本脚本不动流水，
--     但赛季状态若为 ended，清完战绩后仍不能录入（需新建赛季）。
SELECT id, type, amount, balance, description
  FROM prize_pool_transactions
 WHERE season_id IN (SELECT id FROM seasons WHERE name LIKE '%三番战%');


-- ---------- 第 2 步：删除（确认第 1 步输出后再执行；顺序不可调换）----------

-- 2.1 先删对局明细（引用 match_id）
DELETE FROM match_results
 WHERE match_id IN (
        SELECT m.id FROM matches m
         WHERE m.season_id IN (SELECT id FROM seasons WHERE name LIKE '%三番战%')
      );

-- 2.2 再删对局本身
DELETE FROM matches
 WHERE season_id IN (SELECT id FROM seasons WHERE name LIKE '%三番战%');


-- ---------- 第 3 步：验证 ----------

-- 3.1 期望：目标赛季仍在、状态不变、match_count = 0
SELECT id, name, status, is_active,
       (SELECT COUNT(*) FROM matches m WHERE m.season_id = s.id) AS match_count,
       (SELECT COUNT(*) FROM season_players sp WHERE sp.season_id = s.id) AS roster_n
  FROM seasons s WHERE name LIKE '%三番战%';

-- 3.2 期望：0。有值说明删除顺序错了、留下了孤儿明细
SELECT COUNT(*) AS "孤儿对局明细"
  FROM match_results r
 WHERE NOT EXISTS (SELECT 1 FROM matches m WHERE m.id = r.match_id);

-- 3.3 与 1.3 对比：赛季数 / 参赛名单数 / 流水数必须不变；
--     对局数与明细数的减少量应等于 1.2 里目标赛季的行数
SELECT 'seasons'                  AS tbl, COUNT(*) AS n FROM seasons
UNION ALL SELECT 'matches',                  COUNT(*) FROM matches
UNION ALL SELECT 'match_results',            COUNT(*) FROM match_results
UNION ALL SELECT 'season_players',           COUNT(*) FROM season_players
UNION ALL SELECT 'prize_pool_transactions',  COUNT(*) FROM prize_pool_transactions;

-- 3.4 期望：两行相等（余额链未被触碰）
SELECT (SELECT balance    FROM prize_pool_transactions ORDER BY id DESC LIMIT 1) AS "界面奖池余额";
SELECT (SELECT SUM(amount) FROM prize_pool_transactions)                       AS "流水合计";
