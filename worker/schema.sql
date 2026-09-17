-- 三国杀国战积分系统 · D1 建表 SQL

CREATE TABLE IF NOT EXISTS players (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS seasons (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  started_at TEXT DEFAULT (datetime('now')),
  ended_at   TEXT,
  is_active  INTEGER DEFAULT 1
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

CREATE INDEX IF NOT EXISTS idx_match_results_match ON match_results(match_id);
CREATE INDEX IF NOT EXISTS idx_match_results_player ON match_results(player_id);
CREATE INDEX IF NOT EXISTS idx_matches_season ON matches(season_id);
