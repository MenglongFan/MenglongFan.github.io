// 三国杀国战积分系统 · Cloudflare Worker API
// 部署：wrangler deploy

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-House-Key',
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function checkAuth(request, env) {
  const key = request.headers.get('X-House-Key');
  return key && key === env.HOUSE_KEY;
}

// 积分公式：存活者得 (死亡人数+1) 分，死者从死亡人数递减至 1
function calculateScores(results) {
  const total = results.length;
  const survivors = results.filter(r => r.is_survivor === 1);
  const dead = results.filter(r => r.is_survivor === 0);
  const D = dead.length;
  const topScore = D + 1;

  survivors.forEach(r => { r.score = topScore; });
  dead.sort((a, b) => a.rank - b.rank);
  dead.forEach((r, i) => { r.score = D - i; });

  return results;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    try {
      // GET /api/seasons — 赛季列表
      if (path === '/api/seasons' && method === 'GET') {
        const stmt = env.DB.prepare(
          `SELECT s.*,
             (SELECT COUNT(*) FROM matches m WHERE m.season_id = s.id) as match_count
           FROM seasons s
           ORDER BY s.is_active DESC, s.started_at DESC`
        );
        const { results } = await stmt.all();
        return json(results);
      }

      // POST /api/season — 新建赛季
      if (path === '/api/season' && method === 'POST') {
        if (!checkAuth(request, env)) return json({ error: '密码错误' }, 401);
        const body = await request.json();
        // 结束当前活跃赛季
        await env.DB.prepare(
          `UPDATE seasons SET is_active = 0, ended_at = datetime('now') WHERE is_active = 1`
        ).run();
        // 创建新赛季
        const result = await env.DB.prepare(
          `INSERT INTO seasons (name) VALUES (?)`
        ).bind(body.name).run();
        return json({ id: result.meta.last_row_id, name: body.name, is_active: 1 });
      }

      // POST /api/season/:id/end — 结束赛季
      const endMatch = path.match(/^\/api\/season\/(\d+)\/end$/);
      if (endMatch && method === 'POST') {
        if (!checkAuth(request, env)) return json({ error: '密码错误' }, 401);
        const seasonId = endMatch[1];
        await env.DB.prepare(
          `UPDATE seasons SET is_active = 0, ended_at = datetime('now') WHERE id = ?`
        ).bind(seasonId).run();
        return json({ ok: true });
      }

      // GET /api/standings — 排名榜（默认当前活跃赛季）
      if (path === '/api/standings' && method === 'GET') {
        const seasonId = url.searchParams.get('season_id');
        let season;
        if (seasonId) {
          season = await env.DB.prepare(`SELECT * FROM seasons WHERE id = ?`).bind(seasonId).first();
        } else {
          season = await env.DB.prepare(`SELECT * FROM seasons WHERE is_active = 1`).first();
        }
        if (!season) return json({ season: null, standings: [] });

        const stmt = env.DB.prepare(
          `SELECT p.id, p.name,
             SUM(mr.score) as total_score,
             COUNT(mr.id) as match_count,
             SUM(mr.is_survivor) as survival_count
           FROM match_results mr
           JOIN players p ON mr.player_id = p.id
           JOIN matches m ON mr.match_id = m.id
           WHERE m.season_id = ?
           GROUP BY p.id
           ORDER BY total_score DESC, survival_count DESC`
        );
        const { results } = await stmt.bind(season.id).all();
        return json({ season, standings: results });
      }

      // GET /api/players — 花名册
      if (path === '/api/players' && method === 'GET') {
        const stmt = env.DB.prepare(
          `SELECT * FROM players ORDER BY created_at ASC`
        );
        const { results } = await stmt.all();
        return json(results);
      }

      // POST /api/player — 添加玩家
      if (path === '/api/player' && method === 'POST') {
        if (!checkAuth(request, env)) return json({ error: '密码错误' }, 401);
        const body = await request.json();
        const result = await env.DB.prepare(
          `INSERT INTO players (name) VALUES (?)`
        ).bind(body.name).run();
        return json({ id: result.meta.last_row_id, name: body.name });
      }

      // PUT /api/player/:id — 改名
      const putMatch = path.match(/^\/api\/player\/(\d+)$/);
      if (putMatch && method === 'PUT') {
        if (!checkAuth(request, env)) return json({ error: '密码错误' }, 401);
        const body = await request.json();
        await env.DB.prepare(
          `UPDATE players SET name = ? WHERE id = ?`
        ).bind(body.name, putMatch[1]).run();
        return json({ ok: true });
      }

      // DELETE /api/player/:id — 删除（历史记录保留）
      if (putMatch && method === 'DELETE') {
        if (!checkAuth(request, env)) return json({ error: '密码错误' }, 401);
        await env.DB.prepare(`DELETE FROM players WHERE id = ?`).bind(putMatch[1]).run();
        return json({ ok: true });
      }

      // GET /api/player/:id/details — 逐局明细
      const detailMatch = path.match(/^\/api\/player\/(\d+)\/details$/);
      if (detailMatch && method === 'GET') {
        const playerId = detailMatch[1];
        const seasonId = url.searchParams.get('season_id');
        let season;
        if (seasonId) {
          season = await env.DB.prepare(`SELECT * FROM seasons WHERE id = ?`).bind(seasonId).first();
        } else {
          season = await env.DB.prepare(`SELECT * FROM seasons WHERE is_active = 1`).first();
        }
        if (!season) return json({ season: null, details: [] });

        const stmt = env.DB.prepare(
          `SELECT m.id, m.played_at, mr.rank, mr.is_survivor, mr.score
           FROM match_results mr
           JOIN matches m ON mr.match_id = m.id
           WHERE mr.player_id = ? AND m.season_id = ?
           ORDER BY m.played_at DESC`
        );
        const { results } = await stmt.bind(playerId, season.id).all();
        return json({ season, details: results });
      }

      // POST /api/match — 录入成绩
      if (path === '/api/match' && method === 'POST') {
        if (!checkAuth(request, env)) return json({ error: '密码错误' }, 401);
        const body = await request.json();
        const { season_id, results } = body;

        // 验证 5-10 人
        if (results.length < 5 || results.length > 10) {
          return json({ error: '参与人数须为 5-10 人' }, 400);
        }

        // 计算积分
        const scored = calculateScores(results);
        const total = scored.length;
        const survivorCount = scored.filter(r => r.is_survivor === 1).length;

        // 插入 match
        const matchResult = await env.DB.prepare(
          `INSERT INTO matches (season_id, player_count) VALUES (?, ?)`
        ).bind(season_id, total).run();
        const matchId = matchResult.meta.last_row_id;

        // 批量插入 match_results
        for (const r of scored) {
          await env.DB.prepare(
            `INSERT INTO match_results (match_id, player_id, rank, is_survivor, score)
             VALUES (?, ?, ?, ?, ?)`
          ).bind(matchId, r.player_id, r.rank, r.is_survivor, r.score).run();
        }

        return json({ id: matchId, player_count: total, survivors: survivorCount, results: scored });
      }

      return json({ error: '未找到端点' }, 404);
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  }
};
