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
//
// 规则只有一条：**同分即同排名 —— 一个并列组共享「它所占据的那些档位」的金额之和，
// 再整组平摊。**
//
// 档位（按名次从低到高）：倒数第一 15 元 / 倒数第二 10 元 / 倒数第三 5 元。
//
// 关键在「它所占据的那些档位」要按**并列组**算，不能只数位置上的三个。
// 以前是 `standings.slice(-3)` —— 硬取三个位置，于是并列组一旦跨过末三位这条线
// （后两名已定、倒数第三并列就是典型），线内那位缴满 5 元、线外那位永远缴 0。
// 更糟的是谁在线内由 SQL 的排序键（total_score DESC, survival_count DESC）决定：
// 两个同分的人只要存活次数不同，缴费人就会换一个 —— 同一份积分，换个赛季结果不同。
//
// 现在按并列组切分：把积分升序排列后扫一遍，每个同分组看它落在下标 0/1/2 里的
// 是哪几席，那几席的档位金额合并，由**整组**（含界外成员）平摊。
//
// 金额用「分」做整数运算：并列组人数不整除档位总额时（7 人并列分 30 元 = 每人 4.2857…），
// 除不尽的分发给组内排序靠前者，保证入账总额恒等于档位之和。
const TIER_AMOUNTS_CENTS = [1500, 1000, 500]; // 倒数第一 / 倒数第二 / 倒数第三

function calculateBottomThreeFines(standings) {
  if (standings.length < 3) return [];

  // 升序：asc[0] 是最后一名
  const asc = standings.slice().sort((a, b) => a.total_score - b.total_score);
  const fines = [];

  let i = 0;
  while (i < asc.length) {
    // [i, j) 是同分的一段（升序排列保证同分连续）
    let j = i;
    while (j < asc.length && asc[j].total_score === asc[i].total_score) j++;

    // 这一段占了末三位（下标 0/1/2）里的哪几席
    const firstInside = Math.min(i, 3);
    const lastInside = Math.min(j, 3);

    if (lastInside > firstInside) {
      let poolCents = 0;
      for (let k = firstInside; k < lastInside; k++) poolCents += TIER_AMOUNTS_CENTS[k];

      const n = j - i;
      const base = Math.floor(poolCents / n);
      const extra = poolCents - base * n; // 除不尽的分，发给组内靠前者

      for (let k = i; k < j; k++) {
        fines.push({
          player_id: asc[k].id,
          player_name: asc[k].name,
          amount: (base + (k - i < extra ? 1 : 0)) / 100,
        });
      }
    }

    i = j;
  }

  return fines;
}

// 获取当前奖池余额
async function getCurrentBalance(db) {
  const row = await db.prepare(
    `SELECT balance FROM prize_pool_transactions ORDER BY id DESC LIMIT 1`
  ).first();
  return row ? row.balance : 0;
}

// ---------- 赛季状态机 ----------
// active 进行中 / paused 已暂存 / ended 已结束
//
// status 是唯一真相；is_active 是它的冗余投影（恒等于 status === 'active'），
// 留着是因为读接口里有几处 `WHERE is_active = 1` 依赖它。
// 两列必须一起改，所以**只允许通过 setSeasonStatus 写**。
//
// 为什么不做成 SQLite 生成列：现有列不能 ALTER 成 GENERATED，重建表的收益
// 不值得这次的改动量；改成由 Worker 统一维护，代价是记住「别在别处单独写 is_active」。
const SEASON_STATUSES = ['active', 'paused', 'ended'];

async function setSeasonStatus(db, id, status) {
  if (!SEASON_STATUSES.includes(status)) {
    throw new Error(`未知赛季状态：${status}`);
  }
  await db.prepare(
    `UPDATE seasons SET status = ?, is_active = ? WHERE id = ?`
  ).bind(status, status === 'active' ? 1 : 0, id).run();
}

// 结束一个赛季并结算末位罚金，返回 { season, fines, new_balance, match_count }。
//
// 抽成函数是因为有两条路都要走**完整**结算：房主点「结束赛季」，以及
// 「建新赛季时选择结束旧赛季」。以前建新赛季那条路只改状态、不结算 ——
// 旧赛季被标成已结束却一分钱没入账，而且 is_active 归零后 /end 直接 400，
// 再也补不回来。这就是这个 bug 的根，所以两条路必须共用同一段结算。
async function settleSeason(db, seasonId) {
  const season = await db.prepare(
    `SELECT * FROM seasons WHERE id = ?`
  ).bind(seasonId).first();
  if (!season) return { error: '赛季不存在', status: 404 };
  if (season.status === 'ended') return { error: '赛季已结束', status: 400 };

  const { results: standings } = await db.prepare(
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

  // 凑不出末位三名就不算罚金
  const fines = standings.length >= 3 ? calculateBottomThreeFines(standings) : [];

  let balance = await getCurrentBalance(db);
  const statements = [
    db.prepare(
      `UPDATE seasons SET status = 'ended', is_active = 0,
         ended_at = datetime('now'), prize_calculated = 1 WHERE id = ?`
    ).bind(seasonId),
  ];
  for (const fine of fines) {
    // 平摊会出现 4.29 这种二进制除不尽的金额，直接累加会飘：
    // 100 + 4.29×4 + 4.28×3 得到 130.00000000000003。余额是要展示给玩家看的，每步收口到分。
    balance = Math.round((balance + fine.amount) * 100) / 100;
    statements.push(db.prepare(
      `INSERT INTO prize_pool_transactions (season_id, player_id, type, amount, description, balance)
       VALUES (?, ?, 'fine', ?, ?, ?)`
    ).bind(seasonId, fine.player_id, fine.amount, `${season.name}·末位罚金`, balance));
  }
  await db.batch(statements);

  return { season, fines, new_balance: balance, match_count: standings.length };
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
           ORDER BY CASE s.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
                    s.started_at DESC, s.id DESC`
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
        // 当前那个进行中的赛季怎么处理，必须由调用方明说。
        //
        // 以前这里是 `UPDATE seasons SET is_active = 0, ended_at = now() WHERE is_active = 1`，
        // 无条件静默把旧赛季标成已结束 —— 却不算罚金、不置 prize_calculated。
        // 更要命的是 is_active 归零后 /end 直接 400，那笔罚金永远补不回来。
        // 现在缺省不猜：有活跃赛季又没给 resolve_active，就 409 让前端去问人。
        const active = await env.DB.prepare(
          `SELECT id, name FROM seasons WHERE is_active = 1 LIMIT 1`
        ).first();

        const resolve = body.resolve_active;
        if (active && resolve !== 'pause' && resolve !== 'end') {
          return json({
            error: '当前还有进行中的赛季，请先选择「暂存」或「结束」',
            active_season: active,
          }, 409);
        }

        let settled = null;
        if (active && resolve === 'pause') {
          await setSeasonStatus(env.DB, active.id, 'paused');
        } else if (active && resolve === 'end') {
          settled = await settleSeason(env.DB, active.id);
          if (settled.error) return json({ error: settled.error }, settled.status);
        }

        // 创建新赛季
        const result = await env.DB.prepare(
          `INSERT INTO seasons (name, status) VALUES (?, 'active')`
        ).bind(body.name).run();
        const seasonId = result.meta.last_row_id;
        // 绑定参赛选手
        const inserts = playerIds.map(pid =>
          env.DB.prepare(
            `INSERT INTO season_players (season_id, player_id) VALUES (?, ?)`
          ).bind(seasonId, pid)
        );
        await env.DB.batch(inserts);

        return json({
          id: seasonId, name: body.name, status: 'active', is_active: 1,
          player_count: playerIds.length,
          resolved_active: active ? { id: active.id, name: active.name, action: resolve } : null,
          settled_fines: settled ? settled.fines : null,
          new_balance: settled ? settled.new_balance : null,
        });
      }

      // POST /api/season/:id/pause — 暂存赛季（保留在列表里、可恢复、不结算罚金）
      const pauseMatch = path.match(/^\/api\/season\/(\d+)\/pause$/);
      if (pauseMatch && method === 'POST') {
        if (!checkAuth(request, env)) return json({ error: '密码错误' }, 401);
        const seasonId = parseInt(pauseMatch[1]);

        const season = await env.DB.prepare(
          `SELECT * FROM seasons WHERE id = ?`
        ).bind(seasonId).first();
        if (!season) return json({ error: '赛季不存在' }, 404);
        if (season.status === 'ended') return json({ error: '赛季已结束，无法暂存' }, 400);
        if (season.status === 'paused') return json({ ok: true, status: 'paused', unchanged: true });

        await setSeasonStatus(env.DB, seasonId, 'paused');
        return json({ ok: true, status: 'paused' });
      }

      // POST /api/season/:id/resume — 恢复暂存的赛季
      const resumeMatch = path.match(/^\/api\/season\/(\d+)\/resume$/);
      if (resumeMatch && method === 'POST') {
        if (!checkAuth(request, env)) return json({ error: '密码错误' }, 401);
        const seasonId = parseInt(resumeMatch[1]);
        const body = await request.json().catch(() => ({}));

        const season = await env.DB.prepare(
          `SELECT * FROM seasons WHERE id = ?`
        ).bind(seasonId).first();
        if (!season) return json({ error: '赛季不存在' }, 404);
        if (season.status === 'ended') return json({ error: '赛季已结束，无法恢复' }, 400);

        // 同一时刻只能有一个进行中的赛季 —— 所有读接口都假设 `WHERE is_active = 1`
        // 只有一行（`.first()` 拿到谁是不确定的）。所以恢复一个暂存的赛季时，
        // 若已经有别的在跑，同样要求调用方明说怎么处理，不静默抢占。
        const active = await env.DB.prepare(
          `SELECT id, name FROM seasons WHERE is_active = 1 AND id != ? LIMIT 1`
        ).bind(seasonId).first();

        const resolve = body.resolve_active;
        if (active && resolve !== 'pause' && resolve !== 'end') {
          return json({
            error: `「${active.name}」正在进行中，请先选择「暂存」或「结束」它`,
            active_season: active,
          }, 409);
        }

        let settled = null;
        if (active && resolve === 'pause') {
          await setSeasonStatus(env.DB, active.id, 'paused');
        } else if (active && resolve === 'end') {
          settled = await settleSeason(env.DB, active.id);
          if (settled.error) return json({ error: settled.error }, settled.status);
        }

        await setSeasonStatus(env.DB, seasonId, 'active');
        return json({
          ok: true, id: seasonId, name: season.name, status: 'active', is_active: 1,
          resolved_active: active ? { id: active.id, name: active.name, action: resolve } : null,
          settled_fines: settled ? settled.fines : null,
          new_balance: settled ? settled.new_balance : null,
        });
      }

      // POST /api/season/:id/end — 结束赛季 + 计算罚金 + 奖池入账
      // 暂存中的赛季也允许结束（等于「这个赛季不打了，结账」），判据是 status 而不是 is_active。
      const endMatch = path.match(/^\/api\/season\/(\d+)\/end$/);
      if (endMatch && method === 'POST') {
        if (!checkAuth(request, env)) return json({ error: '密码错误' }, 401);
        const result = await settleSeason(env.DB, parseInt(endMatch[1]));
        if (result.error) return json({ error: result.error }, result.status);
        return json({
          ok: true, fines: result.fines,
          new_balance: result.new_balance, match_count: result.match_count,
        });
      }

      // GET /api/standings — 排名榜（默认当前活跃赛季）
      if (path === '/api/standings' && method === 'GET') {
        const seasonId = url.searchParams.get('season_id');
        let season;
        if (seasonId) {
          season = await env.DB.prepare(`SELECT * FROM seasons WHERE id = ?`).bind(seasonId).first();
        } else {
          // 优先进行中的赛季；没有的话**不要直接返回空** —— 赛季全都暂存或结束时，
          // 积分榜页会显示「尚无赛季」，可赛季明明还在，只是没在跑，那个空态是错的。
          // 退而取最近建的那个（不论状态），页头会把「已暂存 / 已结束」标出来。
          season = await env.DB.prepare(
            `SELECT * FROM seasons
              ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
                       started_at DESC, id DESC
              LIMIT 1`
          ).first();
        }
        if (!season) return json({ season: null, standings: [] });

        // 总名次同样不能用「数组下标」给 —— 积分和存活次数完全相同的两个人必须并列。
        // 规则与逐局名次一致：名次 = 1 + 严格排在前面的人数（并列占位、跳号，
        // 即 1 1 3 4 5 而不是 1 1 2 3 4），见 docs/adr/0005。
        //
        // 窗口函数不能和 GROUP BY 写在同一个 SELECT 里，所以先聚合出一层子查询再套 RANK()。
        // 最外层再补一个 id ASC：并列时顺序不能靠 SQLite 的默认行为，否则榜首卡
        // （standings[0]）会在两次刷新之间换人。
        const stmt = env.DB.prepare(
          `SELECT *, RANK() OVER (ORDER BY total_score DESC, survival_count DESC) AS rank
             FROM (
               SELECT p.id, p.name, p.avatar_url,
                  SUM(mr.score) as total_score,
                  COUNT(mr.id) as match_count,
                  SUM(mr.is_survivor) as survival_count
                FROM match_results mr
                JOIN players p ON mr.player_id = p.id
                JOIN matches m ON mr.match_id = m.id
                WHERE m.season_id = ?
                GROUP BY p.id
             )
             ORDER BY total_score DESC, survival_count DESC, id ASC`
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

        // 逐局明细的「名次」由「存活 + 得分」推导，不能直接用 match_results.rank。
        //
        // match_results.rank 存的是录入页的拖拽顺序（MatchPage 的 `rank: i + 1`），
        // 而「存活」是另一个独立开关 —— 两者可以不一致。真实数据里第 20 局就是
        // 两个已淘汰的人占了拖拽顺序的第 1、2 位，直接当名次显示就会出现
        // 「淘汰者显示第 1 名、存活者显示第 3 名」这种明显错误。
        //
        // 推导规则：名次 = 1 + 得分严格高于自己的人数（并列占位、跳号）。
        // calculateScores 保证存活者一律拿最高分 D+1（D = 淘汰人数），
        // 所以存活者必然全部并列第一，其余按得分降序 —— 正是业务定义。
        // 例：第 22 局得分 4,4,3,2,1 → 名次 1,1,3,4,5。
        //
        // rank 列本身不动：它仍是 calculateScores 决定淘汰者先后的输入。
        const stmt = env.DB.prepare(
          `SELECT m.id, m.played_at,
             (SELECT COUNT(*) FROM match_results x
               WHERE x.match_id = mr.match_id AND x.score > mr.score) + 1 AS rank,
             mr.is_survivor, mr.score
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

        // 检查赛季是否还能录入
        const season = await env.DB.prepare(
          `SELECT is_active, status FROM seasons WHERE id = ?`
        ).bind(season_id).first();
        if (!season) return json({ error: '赛季不存在' }, 404);
        if (season.status === 'ended') return json({ error: '赛季已结束，无法录入成绩' }, 400);
        if (!season.is_active) return json({ error: '赛季已暂存，恢复后才能录入成绩' }, 400);

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
        // ROUND(..., 2) 是防御性收口，不是修 bug：平摊会产生 4.29 这种二进制除不尽的金额，
        // 但 SQLite 的 SUM 带补偿求和（实测 300 条随机分位金额累加不飘），所以目前本来也是准的。
        // 这里是要直接展示给玩家看的钱数，多收口一次不吃亏。
        const { results: contributions } = await env.DB.prepare(
          `SELECT p.id, p.name, p.avatar_url,
             ROUND(COALESCE(SUM(ppt.amount), 0), 2) as total_amount
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
