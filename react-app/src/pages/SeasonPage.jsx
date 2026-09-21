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

// 「赛季 → 查看」的只读榜单。和积分榜共用 RankRow，只换外层卡片。
function StandingsView({ standings }) {
  const maxScore = useMemo(
    () => (standings || []).reduce((m, p) => Math.max(m, p.total_score || 0), 1),
    [standings]
  )
  if (!standings || standings.length === 0) {
    return <div className="prize-empty">该赛季暂无对局记录</div>
  }
  return (
    <div>
      {standings.map((p, i) => (
        <div className="rank-item-static" key={p.id}>
          <RankRow player={p} rank={i + 1} maxScore={maxScore} animateIndex={i} />
        </div>
      ))}
    </div>
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
        <StandingsView standings={data.standings} />,
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
        colors={activeCount > 0 ? undefined : ['#F6E3B4', '#C9A44C', '#E9C87C', '#C9A44C', '#F6E3B4']}
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
