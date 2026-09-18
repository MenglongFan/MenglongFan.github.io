-- 三国杀国战积分系统 · D1 建表 SQL

CREATE TABLE IF NOT EXISTS players (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  avatar_url TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS seasons (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  started_at        TEXT DEFAULT (datetime('now')),
  ended_at          TEXT,
  is_active         INTEGER DEFAULT 1,
  prize_calculated  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS matches (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id    INTEGER NOT NULL REFERENCES seasons(id),
  player_count INTEGER NOT NULL,
  played_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS match_results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id    INTEGER NOT NULL REFERENCES matches(id),
  player_id   INTEGER NOT NULL REFERENCES players(id),
  rank        INTEGER NOT NULL,
  is_survivor INTEGER DEFAULT 0,
  score       INTEGER NOT NULL
);

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

CREATE INDEX IF NOT EXISTS idx_match_results_match ON match_results(match_id);
CREATE INDEX IF NOT EXISTS idx_match_results_player ON match_results(player_id);
CREATE INDEX IF NOT EXISTS idx_matches_season ON matches(season_id);
CREATE INDEX IF NOT EXISTS idx_ppt_season ON prize_pool_transactions(season_id);
CREATE INDEX IF NOT EXISTS idx_ppt_player ON prize_pool_transactions(player_id);
CREATE INDEX IF NOT EXISTS idx_ppt_created ON prize_pool_transactions(created_at);

-- 默认花名册（7 名玩家 + NFT 头像）
INSERT OR IGNORE INTO players (id, name, avatar_url) VALUES
  (1, '樊梦龙', './avatars/1-fanmenglong.jpg'),
  (2, '齐济',   './avatars/2-qiji.jpg'),
  (3, '赵振东', './avatars/3-zhaozhendong.jpg'),
  (4, '李晓阳', './avatars/4-lixiaoyang.jpg'),
  (5, '范昊宇', './avatars/5-fanhaoyu.jpg'),
  (6, '肇淘胜', './avatars/6-zhaotaosheng.jpg'),
  (7, '祝振军', './avatars/7-zhuzhenjun.jpg');
