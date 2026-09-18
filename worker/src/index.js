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

// 末尾三名罚金计算（含同分平摊）
// 输入：积分榜（按 total_score 降序，即第一名在前）
// 输出：[{ player_id, player_name, amount }]
function calculateBottomThreeFines(standings) {
  if (standings.length < 3) return [];

  // 取最后三名（积分最低的三个），按积分升序排列 = s1(最低) s2 s3(相对高)
  const bottom = standings.slice(-3).slice().sort((a, b) => a.total_score - b.total_score);
  const [p1, p2, p3] = bottom; // p1=最后一名(最低分), p2=倒数第二, p3=倒数第三

  const s1 = p1.total_score;
  const s2 = p2.total_score;
  const s3 = p3.total_score;

  // 情况 1：三者同分
  if (s1 === s2 && s2 === s3) {
    const each = 30 / 3;
    return [
      { player_id: p1.id, player_name: p1.name, amount: each },
      { player_id: p2.id, player_name: p2.name, amount: each },
      { player_id: p3.id, player_name: p3.name, amount: each },
    ];
  }

  // 情况 2：后两者同分（最后一名与倒数第二名同分）
  if (s1 === s2 && s2 !== s3) {
    const each = 25 / 2;
    return [
      { player_id: p1.id, player_name: p1.name, amount: each },
      { player_id: p2.id, player_name: p2.name, amount: each },
      { player_id: p3.id, player_name: p3.name, amount: 5 },
    ];
  }

  // 情况 3：前两者同分（倒数第二名与倒数第三名同分）
  if (s1 !== s2 && s2 === s3) {
    const each = 15 / 2;
    return [
      { player_id: p1.id, player_name: p1.name, amount: 15 },
      { player_id: p2.id, player_name: p2.name, amount: each },
      { player_id: p3.id, player_name: p3.name, amount: each },
    ];
  }

  // 情况 4：都不同分
  return [
    { player_id: p1.id, player_name: p1.name, amount: 15 },
    { player_id: p2.id, player_name: p2.name, amount: 10 },
    { player_id: p3.id, player_name: p3.name, amount: 5 },
  ];
}

// 获取当前奖池余额
async function getCurrentBalance(db) {
  const row = await db.prepare(
    `SELECT balance FROM prize_pool_transactions ORDER BY id DESC LIMIT 1`
  ).first();
  return row ? row.balance : 0;
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
      // POST /api/auth — 验证房主密码
      if (path === '/api/auth' && method === 'POST') {
        const ok = checkAuth(request, env);
        return json(ok ? { ok: true } : { error: '密码错误' }, ok ? 200 : 401);
      }

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

      // GET /api/season/:id/players — 赛季参赛选手
      const seasonPlayersMatch = path.match(/^\/api\/season\/(\d+)\/players$/);
      if (seasonPlayersMatch && method === 'GET') {
        const seasonId = parseInt(seasonPlayersMatch[1]);
        const { results } = await env.DB.prepare(
          `SELECT p.* FROM season_players sp
           JOIN players p ON sp.player_id = p.id
           WHERE sp.season_id = ?
           ORDER BY p.id`
        ).bind(seasonId).all();
        return json(results);
      }

      // POST /api/season — 新建赛季（含参赛选手绑定）
      if (path === '/api/season' && method === 'POST') {
        if (!checkAuth(request, env)) return json({ error: '密码错误' }, 401);
        const body = await request.json();
        const playerIds = body.player_ids || [];
        if (playerIds.length < 5 || playerIds.length > 10) {
          return json({ error: '参赛人数须为 5-10 人' }, 400);
        }
        // 结束当前活跃赛季
        await env.DB.prepare(
          `UPDATE seasons SET is_active = 0, ended_at = datetime('now') WHERE is_active = 1`
        ).run();
        // 创建新赛季
        const result = await env.DB.prepare(
          `INSERT INTO seasons (name) VALUES (?)`
        ).bind(body.name).run();
        const seasonId = result.meta.last_row_id;
        // 绑定参赛选手
        const inserts = playerIds.map(pid =>
          env.DB.prepare(
            `INSERT INTO season_players (season_id, player_id) VALUES (?, ?)`
          ).bind(seasonId, pid)
        );
        await env.DB.batch(inserts);
        return json({ id: seasonId, name: body.name, is_active: 1, player_count: playerIds.length });
      }

      // POST /api/season/:id/end — 结束赛季 + 计算罚金 + 奖池入账
      const endMatch = path.match(/^\/api\/season\/(\d+)\/end$/);
      if (endMatch && method === 'POST') {
        if (!checkAuth(request, env)) return json({ error: '密码错误' }, 401);
        const seasonId = parseInt(endMatch[1]);

        // 检查赛季是否存在且未结束
        const season = await env.DB.prepare(
          `SELECT * FROM seasons WHERE id = ?`
        ).bind(seasonId).first();
        if (!season) return json({ error: '赛季不存在' }, 404);
        if (!season.is_active) return json({ error: '赛季已结束' }, 400);

        // 获取赛季积分榜
        const { results: standings } = await env.DB.prepare(
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
        ).bind(seasonId).all();

        // 至少需要 3 名玩家参与才能计算罚金
        let fines = [];
        if (standings.length >= 3) {
          fines = calculateBottomThreeFines(standings);
        }

        // 事务：结束赛季 + 写入罚金流水
        const currentBalance = await getCurrentBalance(env.DB);
        let balance = currentBalance;

        // 使用 batch 模拟事务
        const statements = [];

        // 更新赛季状态
        statements.push(env.DB.prepare(
          `UPDATE seasons SET is_active = 0, ended_at = datetime('now'), prize_calculated = 1 WHERE id = ?`
        ).bind(seasonId));

        // 写入每条罚金流水
        for (const fine of fines) {
          balance += fine.amount;
          statements.push(env.DB.prepare(
            `INSERT INTO prize_pool_transactions (season_id, player_id, type, amount, description, balance)
             VALUES (?, ?, 'fine', ?, ?, ?)`
          ).bind(seasonId, fine.player_id, fine.amount, `${season.name}·末位罚金`, balance));
        }

        await env.DB.batch(statements);

        return json({ ok: true, fines, new_balance: balance, match_count: standings.length });
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
          `SELECT p.id, p.name, p.avatar_url,
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
          `INSERT INTO players (name, avatar_url) VALUES (?, ?)`
        ).bind(body.name, body.avatar_url || null).run();
        return json({ id: result.meta.last_row_id, name: body.name, avatar_url: body.avatar_url || null });
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

        // 检查赛季是否已结束
        const season = await env.DB.prepare(
          `SELECT is_active FROM seasons WHERE id = ?`
        ).bind(season_id).first();
        if (!season) return json({ error: '赛季不存在' }, 404);
        if (!season.is_active) return json({ error: '赛季已结束，无法录入成绩' }, 400);

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
        const insertStatements = scored.map(r =>
          env.DB.prepare(
            `INSERT INTO match_results (match_id, player_id, rank, is_survivor, score)
             VALUES (?, ?, ?, ?, ?)`
          ).bind(matchId, r.player_id, r.rank, r.is_survivor, r.score)
        );
        await env.DB.batch(insertStatements);

        return json({ id: matchId, player_count: total, survivors: survivorCount, results: scored });
      }

      // GET /api/prize-pool/summary — 奖池总览
      if (path === '/api/prize-pool/summary' && method === 'GET') {
        const currentBalance = await getCurrentBalance(env.DB);

        // 各玩家贡献榜
        const { results: contributions } = await env.DB.prepare(
          `SELECT p.id, p.name, p.avatar_url, COALESCE(SUM(ppt.amount), 0) as total_amount
           FROM prize_pool_transactions ppt
           JOIN players p ON ppt.player_id = p.id
           WHERE ppt.type = 'fine'
           GROUP BY p.id
           ORDER BY total_amount DESC`
        ).all();

        // 最近 20 条流水
        const { results: recentTransactions } = await env.DB.prepare(
          `SELECT ppt.*, p.name as player_name, s.name as season_name
           FROM prize_pool_transactions ppt
           LEFT JOIN players p ON ppt.player_id = p.id
           LEFT JOIN seasons s ON ppt.season_id = s.id
           ORDER BY ppt.created_at DESC, ppt.id DESC
           LIMIT 20`
        ).all();

        return json({
          current_balance: currentBalance,
          contributions,
          recent_transactions: recentTransactions,
        });
      }

      // GET /api/prize-pool/transactions — 奖池流水列表
      if (path === '/api/prize-pool/transactions' && method === 'GET') {
        const limit = Math.min(parseInt(url.searchParams.get('limit')) || 50, 200);
        const offset = parseInt(url.searchParams.get('offset')) || 0;

        const stmt = env.DB.prepare(
          `SELECT ppt.*, p.name as player_name, s.name as season_name
           FROM prize_pool_transactions ppt
           LEFT JOIN players p ON ppt.player_id = p.id
           LEFT JOIN seasons s ON ppt.season_id = s.id
           ORDER BY ppt.created_at DESC, ppt.id DESC
           LIMIT ? OFFSET ?`
        );
        const { results } = await stmt.bind(limit, offset).all();

        const countRow = await env.DB.prepare(
          `SELECT COUNT(*) as total FROM prize_pool_transactions`
        ).first();

        return json({ transactions: results, total: countRow.total });
      }

      // POST /api/prize-pool/withdraw — 支取奖池
      if (path === '/api/prize-pool/withdraw' && method === 'POST') {
        if (!checkAuth(request, env)) return json({ error: '密码错误' }, 401);
        const body = await request.json();
        const amount = parseFloat(body.amount);
        const description = body.description || '';

        if (!amount || amount <= 0) {
          return json({ error: '支取金额必须大于 0' }, 400);
        }

        const currentBalance = await getCurrentBalance(env.DB);
        if (amount > currentBalance) {
          return json({ error: '奖池余额不足' }, 400);
        }

        const newBalance = currentBalance - amount;
        const result = await env.DB.prepare(
          `INSERT INTO prize_pool_transactions (type, amount, description, balance)
           VALUES ('withdrawal', ?, ?, ?)`
        ).bind(-amount, description || '支取', newBalance).run();

        return json({ success: true, new_balance: newBalance, transaction_id: result.meta.last_row_id });
      }

      return json({ error: '未找到端点' }, 404);
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  }
};
