-- 迁移 001: 奖池系统 & 玩家头像
-- 新增 prize_pool_transactions 表、players.avatar_url 列、默认花名册

-- 1. 为 players 表添加头像列
ALTER TABLE players ADD COLUMN avatar_url TEXT;

-- 2. 创建奖池流水表
CREATE TABLE IF NOT EXISTS prize_pool_transactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id   INTEGER REFERENCES seasons(id),
  player_id   INTEGER REFERENCES players(id),
  type        TEXT NOT NULL,                   -- 'fine' 罚金入账 | 'withdrawal' 支取出账
  amount      REAL NOT NULL,                   -- 正数=入账，负数=支取
  description TEXT,                            -- 用途说明
  balance     REAL NOT NULL,                   -- 操作后奖池余额
  created_at  TEXT DEFAULT (datetime('now'))
);

-- 3. 创建索引
CREATE INDEX IF NOT EXISTS idx_ppt_season ON prize_pool_transactions(season_id);
CREATE INDEX IF NOT EXISTS idx_ppt_player ON prize_pool_transactions(player_id);
CREATE INDEX IF NOT EXISTS idx_ppt_created ON prize_pool_transactions(created_at);

-- 4. 为 seasons 表添加奖池计算标记（如果不存在）
--    注意：SQLite 不支持 IF NOT EXISTS 加列，用 try/catch 方式处理
--    这里直接尝试添加，若已存在会报错但不影响
ALTER TABLE seasons ADD COLUMN prize_calculated INTEGER DEFAULT 0;

-- 5. 默认花名册（7 名玩家 + NFT 头像）
INSERT OR IGNORE INTO players (id, name, avatar_url) VALUES
  (1, '樊梦龙', './avatars/1-fanmenglong.jpg'),
  (2, '齐济',   './avatars/2-qiji.jpg'),
  (3, '赵振东', './avatars/3-zhaozhendong.jpg'),
  (4, '李晓阳', './avatars/4-lixiaoyang.jpg'),
  (5, '范昊宇', './avatars/5-fanhaoyu.jpg'),
  (6, '肇淘胜', './avatars/6-zhaotaosheng.jpg'),
  (7, '祝振军', './avatars/7-zhuzhenjun.jpg');

-- 6. 更新已有玩家的头像（如果玩家已存在但头像为空）
UPDATE players SET avatar_url = './avatars/1-fanmenglong.jpg' WHERE id = 1 AND (avatar_url IS NULL OR avatar_url = '');
UPDATE players SET avatar_url = './avatars/2-qiji.jpg' WHERE id = 2 AND (avatar_url IS NULL OR avatar_url = '');
UPDATE players SET avatar_url = './avatars/3-zhaozhendong.jpg' WHERE id = 3 AND (avatar_url IS NULL OR avatar_url = '');
UPDATE players SET avatar_url = './avatars/4-lixiaoyang.jpg' WHERE id = 4 AND (avatar_url IS NULL OR avatar_url = '');
UPDATE players SET avatar_url = './avatars/5-fanhaoyu.jpg' WHERE id = 5 AND (avatar_url IS NULL OR avatar_url = '');
UPDATE players SET avatar_url = './avatars/6-zhaotaosheng.jpg' WHERE id = 6 AND (avatar_url IS NULL OR avatar_url = '');
UPDATE players SET avatar_url = './avatars/7-zhuzhenjun.jpg' WHERE id = 7 AND (avatar_url IS NULL OR avatar_url = '');
