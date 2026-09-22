import { useState, useEffect, useRef, useMemo, useLayoutEffect, useCallback } from 'react'
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

/**
 * 逐局战绩：滚轮翻局，一次手势正好一局。
 *
 * 原先的做法是「先露 3 局 + 展开全部」——展开后一屏能看到两局半，落点全看滚了多少像素，
 * 想对比第 4 局和第 5 局得自己找位置。这里换成翻页式：
 * 容器高度做成**正好一局**，靠 scroll-snap 把落点对齐到块边界，滚轮一格就是一局。
 *
 * 两个坑：
 * 1. **容器高度不能写死** —— 一局的高度随参赛人数变。用 JS 量出第一块的高度写进
 *    CSS 变量 `--one-match`，再用 ResizeObserver 跟着块高走（人数或窗口宽度变了要重量）。
 * 2. **wheel 必须用原生非被动监听**。React 17+ 把 wheel 注册成 passive，
 *    `onWheel` 里 `preventDefault()` 不生效（控制台还会警告），所以只能
 *    `addEventListener('wheel', h, { passive: false })`。
 *
 * 第三个坑（踩过）：**量高度只能用 offsetHeight / offsetTop，不能用
 * getBoundingClientRect()**。弹窗打开时带 `scrollOpen` 动画（scale(0.96) → 1），
 * 而 ResizeObserver 的首次回调是异步的、可能落在动画中途 —— 那时 rect 拿到的是
 * **被 transform 缩过的值**（实测 386 被量成 382.37），写进 `--one-match` 后容器就比
 * 一局矮 4px，每局底部被裁掉一条。而且 RO 报的是 border-box，transform 变化不触发回调，
 * 这个错值会一直挂着不自愈。offsetHeight / offsetTop 是布局值，不受 transform 影响。
 */
function MatchPager({ matches }) {
  const vpRef = useRef(null)
  const [active, setActive] = useState(0) // 数组下标（0 = 最新一局）；局号 = count - active
  const lockRef = useRef(0)               // 手势锁：同一次滚轮手势里只翻一局
  const strideRef = useRef(0)             // 相邻两块的顶边差 = 块高 + 10px 块间距

  const count = matches ? matches.length : 0

  // 量出一局的高度（= 容器高度）与步进。只在真的变了才写变量，避免 ResizeObserver 自激。
  useLayoutEffect(() => {
    const vp = vpRef.current
    if (!vp || count === 0) return
    const first = vp.querySelector('.match-block')
    if (!first) return
    const measure = () => {
      const blocks = vp.querySelectorAll('.match-block')
      if (!blocks.length) return
      const h = blocks[0].offsetHeight
      if (!h) return
      const cur = parseFloat(vp.style.getPropertyValue('--one-match')) || 0
      if (Math.abs(cur - h) > 0.5) vp.style.setProperty('--one-match', `${h}px`)
      // 相邻两块的顶边差含 margin，不能只拿块高当步进，否则每翻一局会累积 10px 漂移
      strideRef.current = blocks[1] ? blocks[1].offsetTop - blocks[0].offsetTop : h
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(first)
    return () => ro.disconnect()
  }, [count, matches])

  const indexAt = useCallback(() => {
    const vp = vpRef.current
    if (!vp) return 0
    const stride = strideRef.current || vp.clientHeight
    return Math.round(vp.scrollTop / stride)
  }, [])

  const goTo = useCallback((i) => {
    const vp = vpRef.current
    if (!vp) return
    const blocks = vp.querySelectorAll('.match-block')
    if (!blocks.length) return
    const target = blocks[Math.max(0, Math.min(blocks.length - 1, i))]
    // .match-scroller 是 position:relative，所以块的 offsetTop 就是它在内容里的位置，
    // 也就是要滚到的 scrollTop（容器上下无内边距无边框，不用再补偿）
    vp.scrollTo({ top: target.offsetTop, behavior: 'smooth' })
  }, [])

  // 滚轮：一格手势 = 一局。到两端就不拦了，让外层弹窗接着滚。
  useEffect(() => {
    const vp = vpRef.current
    if (!vp || count < 2) return
    const onWheel = (e) => {
      if (e.ctrlKey || e.deltaY === 0) return // 缩放 / 横向滚，交回默认
      const dir = e.deltaY > 0 ? 1 : -1
      const atTop = vp.scrollTop <= 1
      const atBottom = vp.scrollTop >= vp.scrollHeight - vp.clientHeight - 1
      if ((dir < 0 && atTop) || (dir > 0 && atBottom)) return
      e.preventDefault()
      const now = performance.now()
      if (now - lockRef.current < 350) return // 同一次手势里剩下的 wheel 事件直接丢掉
      lockRef.current = now
      goTo(indexAt() + dir)
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [count, goTo, indexAt])

  const onScroll = () => {
    const i = indexAt()
    setActive((prev) => (prev === i ? prev : Math.max(0, Math.min(count - 1, i))))
  }

  // 键盘：监听挂在 document 上，**不能挂在滚动器上**。
  // 滚动器虽然 tabIndex={0}，但打开弹窗时焦点在 <body>（按钮点完焦点不进来），
  // 用户按 ↑↓ 时事件根本到不了它 —— 提示写着「滚轮 / ↑↓ 翻局」却按不动，就是这个原因。
  // 挂 document 就得自己判断「现在该不该接管」，四条放行规则：
  //   1) 带修饰键（⌘/Ctrl/Alt）—— 那是浏览器/系统快捷键；
  //   2) 焦点在输入框/可编辑区里 —— 别抢它的上下键；
  //   3) 自己不在视口里（弹窗关了、在别的路由上）—— 别越界；
  //   4) 不是这几个键 —— 一概不动。
  // 只处理一次：原来那个元素上的 onKeyDown 必须去掉，否则焦点在滚动器上时
  // 元素处理器和这里会各翻一局（一次按键翻两局）。
  useEffect(() => {
    const vp = vpRef.current
    if (!vp || count < 2) return
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      const r = vp.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return
      if (r.bottom <= 0 || r.top >= window.innerHeight) return
      if (e.key === 'Home') { e.preventDefault(); goTo(0); return }
      if (e.key === 'End') { e.preventDefault(); goTo(count - 1); return }
      const step = { ArrowDown: 1, ArrowRight: 1, PageDown: 1, ArrowUp: -1, ArrowLeft: -1, PageUp: -1 }[e.key]
      if (!step) return
      // 不 preventDefault 的话，弹窗背后的页面会跟着滚
      e.preventDefault()
      goTo(indexAt() + step)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [count, goTo, indexAt])

  return (
    <div className="match-section">
      <div className="match-hd">
        <h3>逐局战绩</h3>
        {/* 窄屏下 .match-hd 是 flex + space-between，右侧 flex-shrink:0，
            所以标签要短：「第 5 局 · 共 5 局」在 320px 会把标题挤出去 */}
        <span>{matches ? (count > 0 ? `第 ${count - active} / ${count} 局` : '0 局') : '读取中'}</span>
      </div>

      {matches && count === 0 && <div className="prize-empty">暂无对局记录</div>}

      {count > 0 && (
        <>
          {/* 提示放在滚动器**上方**：放下面会被弹窗自身的滚动切掉，等于没有 */}
          {count > 1 && <div className="match-hint">滚轮 / ↑↓ 翻局 · 一次一局</div>}
          <div
            className="match-scroller"
            ref={vpRef}
            tabIndex={0}
            role="group"
            aria-label={`逐局战绩，共 ${count} 局，滚轮或上下方向键翻局`}
            onScroll={onScroll}
          >
            {matches.map((m, mi) => (
              <div className="match-block" key={m.id}>
                <div className="match-block-hd">
                  <span className="match-no">第 {count - mi} 局</span>
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
        </>
      )}
    </div>
  )
}

/**
 * 「赛季 → 查看」的内容，两块：
 *  1) 个人总榜 —— 点行展开该选手的逐局战绩（复用积分榜那套 .rank-detail）
 *  2) 整赛季逐局战绩 —— 一局一块，列出该局所有人的名次 / 得分 / 存亡
 *
 * 后端没有「整赛季所有对局」的接口，这里拉每个选手的 /details 后按 match_id 归并，
 * 目的是不改 Worker、不重新部署后端。选手数就是 5-10，并行发一轮请求即可；
 * 而且归并结果与「点行展开」共用同一份数据 —— 展开时不再发请求，点了就开。
 *
 * 布局要求（用户提的）：**永远不要出现滚动条**，总榜和逐局战绩都要看得见。
 * 参赛最多 10 人，所以：宽屏排成左右两栏（总榜在左、逐局战绩在右），两块不再
 * 互相抢高度；窄屏退回上下两段，总榜这块按「拿到多少高度 / 几个人」自己算行高
 * （--row-h），人少就原样铺开、人多就整行等比压一点，尽量压到不用滚。
 */
function SeasonDetail({ season, standings }) {
  const [openId, setOpenId] = useState(null)
  // null = 读取中；否则是 playerId -> 逐局数组
  const [byPlayer, setByPlayer] = useState(null)
  const ranksRef = useRef(null)

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

  // 行高自适应。总榜这块能拿到多少高度，**必须从视口往下减**，不能读 el.clientHeight：
  // 弹窗高度是 auto（内容多高就多高，只受 max-height 封顶），而 .season-ranks 又随内容伸缩，
  // 拿 clientHeight 去算就是自己咬自己 —— 行高改小 → 内容变矮 → 弹窗变矮 → 下次算出来更小，
  // 一路棘轮到下限，而且这个错值还是个自洽的固定点，再也不会自己回来
  // （踩过：800px 宽下 61px 掉成 48px，10 人榜被压出内滚）。
  //
  //   65px = 自然高度（不压缩），48px = 压到底（再小头像和两行字就要打架）。
  // 压完还是不够就交给内滚兜底 —— 只会在「10 人 + 窄屏」同时出现，这时
  // 用 data-overflow / data-at-end 在列表底部点一层渐隐，提示「下面还有人」。
  // 没有滚动条就只剩这个提示了，不给的话 7-10 名看起来像不存在。
  useLayoutEffect(() => {
    const el = ranksRef.current
    if (!el) return
    const GAP = 9
    const ROW_MIN = 48
    const ROW_MAX = 65

    const setAttr = (k, v) => { if (el.dataset[k] !== v) el.dataset[k] = v }
    const syncFade = () => {
      const over = el.scrollHeight - el.clientHeight
      setAttr('overflow', over > 2 ? '1' : '0')
      setAttr('atEnd', over > 2 && el.scrollTop < over - 2 ? '0' : '1')
    }

    // 视口高度 − 弹窗外内边距与边框 − 页头页脚 − 主体上下内边距
    //   − 列标题（含其下边距，用 el.offsetTop 取，见下）−（上下两段时）逐局战绩那一块
    // 全是布局值（offsetHeight / offsetTop / computed padding），不受弹窗打开动画的
    // transform 影响；弹窗自身的高度**故意不参与**，因为它是 auto、会跟着行高变。
    const avail = () => {
      const modal = el.closest('.modal')
      if (!modal) return el.clientHeight
      const body = el.closest('.modal-body')
      const overlay = modal.parentElement
      const header = modal.querySelector('.modal-header')
      const footer = modal.querySelector('.modal-footer')
      const det = el.closest('.season-detail')
      const stacked = det && getComputedStyle(det).flexDirection === 'column'
      const match = stacked ? modal.querySelector('.match-section') : null
      const px = (v) => parseFloat(v) || 0
      const ov = getComputedStyle(overlay)
      const bd = getComputedStyle(body)
      const md = getComputedStyle(modal)
      return window.innerHeight
        - px(ov.paddingTop) - px(ov.paddingBottom)
        - px(md.borderTopWidth) - px(md.borderBottomWidth)
        - (header ? header.offsetHeight : 0)
        - (footer ? footer.offsetHeight : 0)
        - px(bd.paddingTop) - px(bd.paddingBottom)
        // .season-col 是 position:relative，所以 el.offsetTop 正好等于
        // 「列标题高度 + 它的下边距」——比手写 colHd.offsetHeight + marginBottom 稳
        - el.offsetTop
        - (match ? match.offsetHeight : 0)
    }

    const apply = () => {
      const n = el.children.length
      if (!n) return
      const fit = (avail() - GAP * (n - 1)) / n
      const h = Math.max(ROW_MIN, Math.min(ROW_MAX, Math.floor(fit)))
      const cur = parseFloat(el.style.getPropertyValue('--row-h')) || 0
      // 只在真的变了才写，避免 ResizeObserver 自激
      if (Math.abs(cur - h) > 0.5) el.style.setProperty('--row-h', `${h}px`)
      // 写完再读一次溢出量（新行高下的）
      syncFade()
    }
    apply()
    // 观察 el 是为了跟着「窗口变了 / 逐局战绩那一块变高了」重量；
    // 行高本身由 avail() 决定，不会反过来把 avail() 改小，所以不会自激。
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    el.addEventListener('scroll', syncFade, { passive: true })
    return () => { ro.disconnect(); el.removeEventListener('scroll', syncFade) }
  }, [list.length])

  const toggle = (p, e) => {
    const next = openId === p.id ? null : p.id
    setOpenId(next)
    // 展开后明细可能落在可视区外，滚进来看。这块是内滚容器，所以用 nearest 而不是 start，
    // 免得已经看得见的行被顶到顶上。
    // 注意 currentTarget 必须在事件回调里**同步**取出来：React 处理完就把合成事件的
    // currentTarget 置空了，等到 rAF 里再读就是 null（踩过：静默抛 TypeError）。
    const el = e && e.currentTarget
    if (next && el) {
      requestAnimationFrame(() => {
        if (el.isConnected) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      })
    }
  }

  if (list.length === 0) {
    return <div className="prize-empty">该赛季暂无对局记录</div>
  }

  const loading = byPlayer === null

  return (
    // .season-detail 不只是个包裹：它把弹窗主体改成「总榜可伸缩 + 逐局战绩固定在下」，
    // 宽屏下再横过来排成两栏。见 global.css 的 .modal:has(.season-detail)。
    <div className="season-detail">
      {/* 个人总榜：这块自己伸缩，不跟逐局战绩抢高度 */}
      <div className="season-col">
        <div className="season-col-hd">
          <h3>个人总榜</h3>
          <span>{list.length} 人</span>
        </div>
        <div className="season-ranks" ref={ranksRef}>
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
                onClick={(e) => toggle(p, e)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggle(p, e)
                  }
                }}
              >
                {/* 名次取后端的并列名次，不用下标 —— 同积分同存活必须并列（见积分榜同款说明） */}
                <RankRow player={p} rank={p.rank ?? i + 1} maxScore={maxScore} animateIndex={i} />
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
        </div>
      </div>

      {/* 逐局战绩：滚轮翻局，一次一局。标题、局号与空态都由 MatchPager 自己渲染。
          这一段不参与伸缩（flex:0 0 auto），永远整块可见。 */}
      <MatchPager matches={matches} />
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
