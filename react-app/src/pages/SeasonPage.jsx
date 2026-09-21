import { useState, useEffect, useRef, useMemo } from 'react'
import { api, getDefaultSeasonName } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useAuthGate } from '../lib/authGate'
import Avatar from '../components/Avatar'
import PageHead from '../components/PageHead'
import GoldButton from '../components/GoldButton'
import RankRow from '../components/RankRow'

// 新建赛季：勾选 5-10 名参赛选手
function SeasonCreate({ players, submitRef }) {
  const [name, setName] = useState(getDefaultSeasonName())
  const [selected, setSelected] = useState(() => new Set(players.map((p) => p.id)))

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else {
        if (next.size >= 10) return prev
        next.add(id)
      }
      return next
    })
  }

  const selectAll = () => setSelected(new Set(players.slice(0, 10).map((p) => p.id)))
  const clearAll = () => setSelected(new Set())

  const count = selected.size
  const countClass = (count < 5 || count > 10) ? 'warn' : 'ok'

  submitRef.current = () => ({ name: name.trim(), ids: Array.from(selected) })

  return (
    <>
      <div className="sort-hint">勾选本赛季的参赛选手（<b>5-10 人</b>），整个赛季期间选手不变。</div>
      <div className="pick-actions">
        <button onClick={selectAll}>全选</button>
        <button onClick={clearAll}>清空</button>
      </div>
      <div className="player-pick-list">
        {players.map((p) => {
          const isSel = selected.has(p.id)
          return (
            <div key={p.id} className={`player-pick ${isSel ? 'selected' : ''}`} onClick={() => toggle(p.id)}>
              <Avatar url={p.avatar_url} name={p.name} className="pick-avatar" />
              <div className="check">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>
              </div>
              <label onClick={(e) => { e.preventDefault(); toggle(p.id) }}>{p.name}</label>
            </div>
          )
        })}
      </div>
      <div className={`player-count ${countClass}`}>已选 {count} 人</div>
      <div className="form-group" style={{ marginTop: 16 }}>
        <label className="form-label">赛季名称</label>
        <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
    </>
  )
}

// 空数组常量：standings 为空时保证 effect 依赖引用稳定，避免反复重跑
const EMPTY = []

// 逐局战绩默认先露几局（超过才折叠，和奖池流水的阈值同理）
const MATCH_PREVIEW = 3

/**
 * 「赛季 → 查看」的内容，两块：
 *  1) 个人总榜 —— 点行展开该选手的逐局战绩（复用积分榜那套 .rank-detail）
 *  2) 整赛季逐局战绩 —— 一局一块，列出该局所有人的名次 / 得分 / 存亡
 *
 * 后端没有「整赛季所有对局」的接口，这里拉每个选手的 /details 后按 match_id 归并，
 * 目的是不改 Worker、不重新部署后端。选手数就是 5-10，并行发一轮请求即可；
 * 而且归并结果与「点行展开」共用同一份数据 —— 展开时不再发请求，点了就开。
 */
function SeasonDetail({ season, standings }) {
  const [openId, setOpenId] = useState(null)
  const [matchesOpen, setMatchesOpen] = useState(false)
  // null = 读取中；否则是 playerId -> 逐局数组
  const [byPlayer, setByPlayer] = useState(null)

  const list = standings || EMPTY

  const maxScore = useMemo(
    () => list.reduce((m, p) => Math.max(m, p.total_score || 0), 1),
    [list]
  )

  useEffect(() => {
    if (!season || list.length === 0) { setByPlayer({}); return }
    let alive = true
    Promise.all(
      list.map((p) =>
        api(`/api/player/${p.id}/details?season_id=${season.id}`)
          .then((d) => [p.id, d.details || []])
          .catch(() => [p.id, []])
      )
    ).then((pairs) => { if (alive) setByPlayer(Object.fromEntries(pairs)) })
    return () => { alive = false }
  }, [season, list])

  // 按 match_id 归并成「每一局」：时间倒序，局内按名次升序
  const matches = useMemo(() => {
    if (!byPlayer) return null
    const map = new Map()
    for (const p of list) {
      for (const r of byPlayer[p.id] || []) {
        if (!map.has(r.id)) map.set(r.id, { id: r.id, played_at: r.played_at, rows: [] })
        // 注意 r.id 是 match_id（同一局里每个人都相同），必须另带 player_id 才能当 key
        map.get(r.id).rows.push({ ...r, player_id: p.id, name: p.name })
      }
    }
    const arr = [...map.values()]
      .sort((a, b) => String(b.played_at).localeCompare(String(a.played_at)))
    for (const m of arr) m.rows.sort((a, b) => a.rank - b.rank)
    return arr
  }, [byPlayer, list])

  // match_id -> 局号。后端 matches 表没有 match_no 列，局号只能按时间倒序推：
  // 最新的那局是最后一局。个人明细和下方「逐局战绩」共用这一份推导，
  // 两处标的局号必然一致（played_at 精确到秒，排序是严格全序，不会串号）。
  //
  // 为什么非标局号不可：界面上的日期只到分钟，同一分钟内开的两局会显示成
  // 完全一样的两行（真实数据里就有 05:15:57 和 05:15:33），不标局号根本分不清。
  const matchNoById = useMemo(() => {
    const m = new Map()
    if (matches) matches.forEach((x, i) => m.set(x.id, matches.length - i))
    return m
  }, [matches])

  if (list.length === 0) {
    return <div className="prize-empty">该赛季暂无对局记录</div>
  }

  const loading = byPlayer === null
  const matchCount = matches ? matches.length : 0
  const canFoldMatches = matchCount > MATCH_PREVIEW
  const shownMatches = matches
    ? (canFoldMatches && !matchesOpen ? matches.slice(0, MATCH_PREVIEW) : matches)
    : []

  return (
    <>
      {list.map((p, i) => {
        const open = openId === p.id
        const rows = byPlayer ? (byPlayer[p.id] || []) : null
        return (
          <div
            key={p.id}
            className={`rank-item-static expandable${open ? ' is-open' : ''}`}
            role="button"
            tabIndex={0}
            aria-expanded={open}
            onClick={() => setOpenId(open ? null : p.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setOpenId(open ? null : p.id)
              }
            }}
          >
            <RankRow player={p} rank={i + 1} maxScore={maxScore} animateIndex={i} />
            <div className={`rank-detail ${open ? 'show' : ''}`}>
              {open && (loading ? (
                <div className="detail-note">加载中...</div>
              ) : rows.length === 0 ? (
                <div className="detail-note">暂无对局记录</div>
              ) : (
                rows.map((d) => (
                  <div className="detail-row" key={d.id}>
                    <span className="d-left">
                      <span className="d-top">
                        <span className={`stamp ${d.is_survivor ? 'alive' : 'dead'}`}>
                          {d.is_survivor ? '存' : '亡'}
                        </span>
                        {matchNoById.has(d.id) && (
                          <span className="d-no">第 {matchNoById.get(d.id)} 局</span>
                        )}
                      </span>
                      <span className="d-date">
                        {d.played_at ? d.played_at.slice(5, 16).replace('T', ' ') : '—'}
                      </span>
                    </span>
                    <span className="d-rank">第 {d.rank} 名</span>
                    <span className="score-val">{d.score}分</span>
                  </div>
                ))
              ))}
            </div>
          </div>
        )
      })}

      <div className="match-hd">
        <h3>逐局战绩</h3>
        <span>{matches ? `${matchCount} 局` : '读取中'}</span>
      </div>

      {matches && matchCount === 0 && <div className="prize-empty">暂无对局记录</div>}

      {matches && matchCount > 0 && (
        <>
          <div className={`fold-wrap${canFoldMatches && !matchesOpen ? ' folded' : ' open'}`}>
            <div className="match-list fold-scroll">
              {shownMatches.map((m, mi) => (
                <div className="match-block" key={m.id}>
                  <div className="match-block-hd">
                    <span className="match-no">第 {matchCount - mi} 局</span>
                    <span className="match-date">
                      {m.played_at ? m.played_at.slice(5, 16).replace('T', ' ') : '—'}
                    </span>
                  </div>
                  {m.rows.map((r) => (
                    <div className="match-row" key={r.player_id}>
                      <span className="m-rank">{r.rank}</span>
                      <span className="m-name">{r.name}</span>
                      <span className={`stamp ${r.is_survivor ? 'alive' : 'dead'}`}>
                        {r.is_survivor ? '存' : '亡'}
                      </span>
                      <span className="m-score">{r.score}分</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          {canFoldMatches && (
            <button
              type="button"
              className="fold-more"
              onClick={() => setMatchesOpen((v) => !v)}
              aria-expanded={matchesOpen}
            >
              {matchesOpen ? '收起' : `展开全部 ${matchCount} 局`}
              <i className="chev" />
            </button>
          )}
        </>
      )}
    </>
  )
}

// 赛季列表项：主页面和「赛季管理」弹窗共用
function SeasonItem({ s, onEnd, onView }) {
  return (
    <div className={`season-item ${s.is_active ? 'active' : ''}`}>
      <div className="s-main">
        <div className="s-name">{s.name}</div>
        <div className="s-meta">
          {s.started_at ? s.started_at.slice(0, 10) : ''}
          {s.ended_at ? ' → ' + s.ended_at.slice(0, 10) : ' · 进行中'}
        </div>
      </div>
      <div className="s-actions">
        <span className="s-matches">{s.match_count}局</span>
        {s.is_active
          ? <button className="s-btn" onClick={() => onEnd(s.id)}>结束</button>
          : <button className="s-btn gold" onClick={() => onView(s.id)}>查看</button>}
      </div>
    </div>
  )
}

export default function SeasonPage() {
  const { showToast, confirmAction, setModalContent, closeModal } = useAuth()
  const ensureAuth = useAuthGate()
  const [seasons, setSeasons] = useState([])
  const createSubmitRef = useRef(null)

  const load = async () => {
    try {
      setSeasons(await api('/api/seasons'))
    } catch (e) {
      showToast(e.message, 'error')
    }
  }
  useEffect(() => { load() }, [])

  // 结束罚金弹窗里的「查看奖池」需要路由跳转
  const navigatePrize = () => { window.location.hash = '#/prize' }

  const openManager = () => {
    setModalContent('赛季管理',
      <div>
        {seasons.length === 0 && <div className="prize-empty">暂无赛季</div>}
        {seasons.map((s) => (
          <SeasonItem key={s.id} s={s} onEnd={endSeason} onView={viewSeason} />
        ))}
      </div>,
      <button className="btn btn-ghost" onClick={closeModal}>完成</button>)
  }

  const openCreate = async () => {
    ensureAuth('新建赛季', async () => {
      let players = []
      try {
        players = await api('/api/players')
      } catch (e) {
        showToast(e.message, 'error')
        return
      }
      setModalContent('新建赛季',
        <SeasonCreate players={players} submitRef={createSubmitRef} />,
        <>
          <button className="btn btn-ghost" onClick={openManager}>上一步</button>
          <button
            className="btn btn-primary"
            onClick={async () => {
              const { name, ids } = createSubmitRef.current ? createSubmitRef.current() : { name: '', ids: [] }
              if (!name) { showToast('请输入赛季名称', 'error'); return }
              if (ids.length < 5 || ids.length > 10) { showToast('参赛人数须为 5-10 人', 'error'); return }
              try {
                await api('/api/season', { method: 'POST', auth: true, body: JSON.stringify({ name, player_ids: ids }) })
                await load()
                openManager()
                showToast('赛季已创建', 'success')
              } catch (e) { showToast(e.message, 'error') }
            }}
          >创建赛季</button>
        </>)
    })
  }

  const viewSeason = async (id) => {
    try {
      const data = await api(`/api/standings?season_id=${id}`)
      setModalContent(`赛季 · ${data.season ? data.season.name : ''}`,
        <SeasonDetail season={data.season} standings={data.standings} />,
        <button className="btn btn-ghost" onClick={openManager}>返回</button>)
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const endSeason = (id) => {
    ensureAuth('赛季管理', () => {
      confirmAction('确定结束当前赛季？结束后将自动计算末位罚金并入账奖池。', async () => {
        try {
          const result = await api(`/api/season/${id}/end`, { method: 'POST', auth: true })
          await load()
          openManager()
          showToast('赛季已结束', 'success')
          if (result.fines && result.fines.length > 0) {
            setModalContent('赛季已结束',
              <>
                <div className="fine-result">
                  <div className="fine-result-title">本期罚金明细</div>
                  {result.fines.map((f) => (
                    <div className="fine-item" key={f.player_id}>
                      <Avatar url={null} name={f.player_name} className="fine-avatar" />
                      <span className="fine-name">{f.player_name}</span>
                      <span className="fine-amount">{f.amount}元</span>
                    </div>
                  ))}
                  <div className="fine-result-total">
                    奖池入账 <b>{result.fines.reduce((s, f) => s + f.amount, 0)}元</b> · 新余额 {result.new_balance}元
                  </div>
                </div>
                <div className="cta" style={{ marginTop: 16 }}>
                  <GoldButton onClick={() => { closeModal(); navigatePrize() }}>查看奖池</GoldButton>
                </div>
              </>,
              <button className="btn btn-ghost" onClick={openManager}>返回</button>)
          }
        } catch (e) { showToast(e.message, 'error') }
      })
    })
  }

  const activeCount = seasons.filter((s) => s.is_active).length

  return (
    <>
      <PageHead
        eyebrow="赛季"
        meta={`${seasons.length} 个`}
        title="赛季管理"
        sub={activeCount > 0 ? `${activeCount} 个赛季进行中` : '新建赛季 · 查看战绩 · 结算罚金'}
      />

      <section className="standings">
        {seasons.length === 0 && (
          <div className="standings-empty" style={{ padding: '40px 20px' }}>
            <div className="seal">季</div>
            <div className="big">暂无赛季</div>
            <div>新建一个赛季开始记录</div>
          </div>
        )}

        {seasons.map((s) => (
          <SeasonItem key={s.id} s={s} onEnd={endSeason} onView={viewSeason} />
        ))}

        <div className="cta" style={{ marginTop: seasons.length ? 16 : 0 }}>
          <GoldButton onClick={openCreate}>新建赛季</GoldButton>
        </div>
      </section>
    </>
  )
}
