-- 迁移 002: 赛季选手关联表
-- 参赛选手与赛季绑定，赛季内所有比赛共用同一批选手

CREATE TABLE IF NOT EXISTS season_players (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id  INTEGER NOT NULL REFERENCES seasons(id),
  player_id  INTEGER NOT NULL REFERENCES players(id),
  UNIQUE(season_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_sp_season ON season_players(season_id);
CREATE INDEX IF NOT EXISTS idx_sp_player ON season_players(player_id);
