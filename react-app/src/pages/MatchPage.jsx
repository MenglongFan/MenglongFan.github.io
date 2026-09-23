import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, seasonStatus } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useAuthGate } from '../lib/authGate'
import Avatar from '../components/Avatar'
import PageHead from '../components/PageHead'
import GoldButton from '../components/GoldButton'

// 录入成绩弹窗：拖拽排序淘汰顺序 + 存活切换 + 分数预览
function MatchEntry({ season, players, submitRef, onSubmitted }) {
  const { showToast } = useAuth()
  const [order, setOrder] = useState(
    players.map((p) => ({ player_id: p.id, name: p.name, avatar_url: p.avatar_url, is_survivor: 0 }))
  )
  const [dragIndex, setDragIndex] = useState(null)

  const total = order.length
  const survivors = order.filter((r) => r.is_survivor).length
  const dead = total - survivors
  const topScore = survivors > 0 ? dead + 1 : dead
  const deadList = order.filter((r) => !r.is_survivor)

  const scores = order.map((r) => {
    if (r.is_survivor) return topScore
    return dead - deadList.indexOf(r)
  })

  const toggleSurvivor = (i) => {
    setOrder((prev) => prev.map((r, idx) => idx === i ? { ...r, is_survivor: r.is_survivor ? 0 : 1 } : r))
  }

  const drop = (targetIndex) => {
    if (dragIndex === null || dragIndex === targetIndex) return
    setOrder((prev) => {
      const next = [...prev]
      const [moved] = next.splice(dragIndex, 1)
      next.splice(targetIndex, 0, moved)
      return next
    })
    setDragIndex(null)
  }

  const handleSubmit = async () => {
    const results = order.map((r, i) => ({
      player_id: r.player_id,
      rank: i + 1,
      is_survivor: r.is_survivor,
    }))
    try {
      await api('/api/match', {
        method: 'POST',
        auth: true,
        body: JSON.stringify({ season_id: season.id, results }),
      })
      onSubmitted()
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  // 让外部页脚「提交」按钮始终调用最新闭包
  submitRef.current = handleSubmit

  return (
    <>
      <div className="sort-hint">
        拖拽排列淘汰顺序（<b>上方 = 最后存活</b>，下方 = 先出局）。点击右侧按钮标记存活者。
      </div>
      <div className="sort-list">
        {order.map((r, i) => (
          <div
            key={r.player_id}
            className={`sort-item ${r.is_survivor ? 'survivor' : ''} ${dragIndex === i ? 'dragging' : ''}`}
            draggable
            onDragStart={() => setDragIndex(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => drop(i)}
            onDragEnd={() => setDragIndex(null)}
          >
            <span className="sort-handle">⠿</span>
            <span className="sort-rank">{i + 1}</span>
            <Avatar url={r.avatar_url} name={r.name} className="sort-avatar" />
            <span className="sort-name">{r.name}</span>
            <span className="sort-score">{scores[i]}</span>
            <button
              className={`sort-toggle ${r.is_survivor ? 'active' : ''}`}
              onClick={() => toggleSurvivor(i)}
              title="存活/淘汰"
            >
              {r.is_survivor ? '存' : '亡'}
            </button>
          </div>
        ))}
      </div>
      <div className="score-preview">
        <div className="score-preview-title">
          <span>分数预览</span>
          <span className="top-score">存活 {survivors} · 淘汰 {dead} · 最高 {topScore} 分</span>
        </div>
        <div className="score-preview-grid">
          {order.map((r, i) => (
            <span key={r.player_id} className={`score-chip ${r.is_survivor ? 'survivor' : ''}`}>
              {r.name}<span className="val">{scores[i]}</span>
            </span>
          ))}
        </div>
      </div>
    </>
  )
}

export default function MatchPage() {
  const navigate = useNavigate()
  const { showToast, setModalContent, closeModal } = useAuth()
  const ensureAuth = useAuthGate()
  const [season, setSeason] = useState(null)
  const [loading, setLoading] = useState(true)
  const submitRef = useRef(null)

  const onSubmitted = () => {
    closeModal()
    showToast('成绩已录入', 'success')
    navigate('/')
  }

  useEffect(() => {
    api('/api/standings').then((data) => setSeason(data.season)).catch(() => setSeason(null)).finally(() => setLoading(false))
  }, [])

  const openEntry = async () => {
    // 只有「进行中」的赛季能录入。已暂存的不算 —— 暂存的意思是「先搁着」，
    // 它上面的对局应该冻住，要接着打必须先恢复。
    if (seasonStatus(season) !== 'active') {
      showToast('请先新建或恢复赛季', 'error')
      navigate('/season')
      return
    }
    try {
      const players = await api(`/api/season/${season.id}/players`)
      if (!players || players.length < 5) {
        setModalContent('录入成绩',
          <div className="detail-note" style={{ padding: 24, fontSize: 14 }}>本赛季参赛选手不足 5 人</div>,
          <button className="btn btn-ghost" onClick={closeModal}>关闭</button>)
        return
      }
      setModalContent('录入成绩 · 排序',
        <MatchEntry season={season} players={players} submitRef={submitRef} onSubmitted={onSubmitted} />,
        <>
          <button className="btn btn-ghost" onClick={closeModal}>取消</button>
          <button className="btn btn-primary" onClick={() => submitRef.current && submitRef.current()}>提交</button>
        </>)
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  if (loading) {
    return (
      <>
        <PageHead eyebrow="录入" meta="读取中" title="录入战绩" sub="正在同步赛季信息" />
        <div className="standings-empty"><div className="big">加载中...</div></div>
      </>
    )
  }

  if (seasonStatus(season) !== 'active') {
    return (
      <>
        <PageHead eyebrow="录入" meta="无进行中赛季" title="录入战绩" sub="新建或恢复赛季后即可录入对局" muted />
        <div className="standings">
          <div className="standings-empty">
            <div className="seal">战</div>
            <div className="big">尚无进行中的赛季</div>
            <div>到「赛季」页新建赛季，或恢复已暂存的赛季</div>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <PageHead
        eyebrow={`${season.name} · 进行中`}
        meta="本局"
        title="录入战绩"
        sub="拖拽排序淘汰顺序 · 点右侧标记存活"
      />

      <section className="standings">
        <div className="entry-card">
          <div className="entry-mark">战</div>
          <div className="entry-title">录入本局成绩</div>
          <p className="entry-desc">
            为「{season.name}」记录一局对局。<br />
            需要先勾选本局到场的 5–10 人，再排出淘汰顺序。
          </p>
          <div className="cta">
            <GoldButton onClick={() => ensureAuth('录入成绩', openEntry)}>开始录入</GoldButton>
          </div>
        </div>
      </section>
    </>
  )
}
