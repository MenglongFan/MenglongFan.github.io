-- migration-003: 赛季三态（active / paused / ended）
--
-- 背景：以前 seasons 只有 is_active(0/1)，表达不了「暂存」。
-- 于是 POST /api/season 只能把旧赛季无条件标成已结束：
--   UPDATE seasons SET is_active = 0, ended_at = datetime('now') WHERE is_active = 1
-- 那条路径**不算末位罚金、不写 prize_pool_transactions、不置 prize_calculated**，
-- 而 /api/season/:id/end 又以 !is_active 为前置条件直接 400 ——
-- 旧赛季于是落进「看起来已结束、其实从没结算、且再也补不回来」的死角。
--
-- 本迁移加一个 status 列作为唯一真相；is_active 保留为冗余列
-- （恒等于 status === 'active'），这样老代码里几处 `WHERE is_active = 1` 不用动。
-- 两者由 Worker 的 setSeasonStatus() 一起维护，**不要在别处单独写其中一列**。
--
-- 幂等性：ADD COLUMN 重复执行会报 "duplicate column name"，属预期；本脚本只跑一次。

ALTER TABLE seasons ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

-- 回填历史数据。旧模型下不存在「暂存」，所以只可能是这两种之一。
UPDATE seasons SET status = CASE WHEN is_active = 1 THEN 'active' ELSE 'ended' END;

CREATE INDEX IF NOT EXISTS idx_seasons_status ON seasons(status);
