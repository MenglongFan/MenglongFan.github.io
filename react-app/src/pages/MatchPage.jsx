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
  const listRef = useRef(null)
  const dragRef = useRef(null)
  const detachRef = useRef(null)

  // 弹窗被关掉时把挂在 window 上的拖拽监听摘干净
  useEffect(() => () => { if (detachRef.current) detachRef.current() }, [])

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

  // 拖拽排序。
  //
  // **不用 HTML5 原生拖拽**（`draggable` + onDragStart/onDragOver/onDrop）：
  // 那套在触屏上根本不触发 dragstart —— 手指滑动被浏览器当成滚动，
  // 所以手机上完全没法排序。改用 Pointer Events，鼠标 / 触摸 / 触控笔一条路径。
  //
  // 触屏只允许从左侧把手起拖（`.sort-handle` 上有 `touch-action:none`）：
  // 若整行都能起拖，手指在行上滑动就会被当成拖拽，列表再也滚不动了。
  // 鼠标保持原来的手感 —— 整行都能拖。
  const startDrag = (e, i) => {
    if (dragRef.current) return
    const isMouse = e.pointerType === 'mouse' || e.pointerType === ''
    if (isMouse) {
      if (e.button !== 0) return                     // 只认左键
      if (e.target.closest('.sort-toggle')) return   // 点在「存/亡」上是点击，不是拖拽
    } else if (!e.target.closest('.sort-handle')) {
      return
    }

    const list = listRef.current
    if (!list) return

    // 10 人赛季时列表比弹窗高（390×844 实测可滚 448px），
    // 先找出「手指停在边缘时该滚谁」。
    let scroller = null
    for (let el = list.parentElement; el; el = el.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight) {
        scroller = el
        break
      }
    }

    dragRef.current = { index: i, y: e.clientY }
    setDragIndex(i)

    // 每次移动都重新量中线。容器被自动滚动过之后，上一帧量到的位置就作废了。
    // 最多 10 行，每帧一次 getBoundingClientRect，开销可以忽略。
    const measure = () =>
      [...list.querySelectorAll('.sort-item')].map((r) => {
        const b = r.getBoundingClientRect()
        return b.top + b.height / 2
      })

    // 落点 = 中线离手指最近的那一行
    const applyTarget = () => {
      const d = dragRef.current
      if (!d) return
      const mids = measure()
      let target = 0
      let best = Infinity
      for (let k = 0; k < mids.length; k++) {
        const dist = Math.abs(d.y - mids[k])
        if (dist < best) { best = dist; target = k }
      }
      if (target === d.index) return
      const from = d.index
      d.index = target
      setDragIndex(target)
      setOrder((prev) => {
        const next = [...prev]
        const [moved] = next.splice(from, 1)
        next.splice(target, 0, moved)
        return next
      })
    }

    // 手指停在容器上下边缘时自动滚动。没有这一步，10 人赛季里排在最后的
    // 几行一开始就在屏幕外，一个手势永远拖不到第一位 —— 只能反复
    // 「拖一下、松手、滚一屏」，那和不能拖也没差多少。
    const EDGE = 56
    let raf = 0
    const tick = () => {
      const d = dragRef.current
      if (!d || !scroller) return
      const b = scroller.getBoundingClientRect()
      let dy = 0
      if (d.y < b.top + EDGE) dy = -Math.ceil((b.top + EDGE - d.y) / 4)
      else if (d.y > b.bottom - EDGE) dy = Math.ceil((d.y - (b.bottom - EDGE)) / 4)
      if (dy) {
        const before = scroller.scrollTop
        scroller.scrollTop = before + dy
        // 真的滚动了才重算落点；已经滚到顶/底就什么都不做，避免抖动
        if (scroller.scrollTop !== before) applyTarget()
      }
      raf = requestAnimationFrame(tick)
    }

    const onMove = (ev) => {
      const d = dragRef.current
      if (!d) return
      d.y = ev.clientY
      applyTarget()
    }

    const onUp = () => { if (detachRef.current) detachRef.current() }

    detachRef.current = () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      detachRef.current = null
      dragRef.current = null
      setDragIndex(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    raf = requestAnimationFrame(tick)
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
        拖住左侧 <b>⠿</b> 上下拖动，排列淘汰顺序（<b>上方 = 最后存活</b>，下方 = 先出局）。点击右侧按钮标记存活者。
      </div>
      <div className="sort-list" ref={listRef}>
        {order.map((r, i) => (
          <div
            key={r.player_id}
            className={`sort-item ${r.is_survivor ? 'survivor' : ''} ${dragIndex === i ? 'dragging' : ''}`}
            onPointerDown={(e) => startDrag(e, i)}
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
