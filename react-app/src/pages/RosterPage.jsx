import { useState, useEffect, useRef } from 'react'
import { api } from '../lib/api'
import { useHeightGuard } from '../lib/useHeightGuard'
import { useAuth } from '../lib/auth'
import { useAuthGate } from '../lib/authGate'
import Avatar from '../components/Avatar'
import PageHead from '../components/PageHead'
import Magnet from '../bits/Magnet/Magnet'

export default function RosterPage() {
  const { showToast, confirmAction } = useAuth()
  const ensureAuth = useAuthGate()
  const [players, setPlayers] = useState([])
  const [drafts, setDrafts] = useState({})
  const [newName, setNewName] = useState('')

  const load = async () => {
    try {
      const data = await api('/api/players')
      setPlayers(data)
      setDrafts(Object.fromEntries(data.map((p) => [p.id, p.name])))
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  useEffect(() => { load() }, [])

  // 花名册的高度护栏。ADR 0009 已记录：390×844 下这一页 docH=850、比视口多 6px
  // （改造前就有，不是动画带来的）。1440×900 下更紧：7 人余量只剩 37px，
  // **第 8 人起滚**（923px）—— 而这一页正是会不断加人的地方。
  const listRef = useRef(null)
  useHeightGuard(listRef, [players])

  const rename = (id) => {
    const name = (drafts[id] || '').trim()
    const orig = players.find((p) => p.id === id)
    if (!name || !orig || name === orig.name) return
    ensureAuth('花名册管理', async () => {
      try {
        await api(`/api/player/${id}`, { method: 'PUT', auth: true, body: JSON.stringify({ name }) })
        setPlayers((prev) => prev.map((p) => p.id === id ? { ...p, name } : p))
        showToast('已更新', 'success')
      } catch (e) {
        showToast(e.message, 'error')
        setDrafts((prev) => ({ ...prev, [id]: orig.name }))
      }
    })
  }

  const remove = (id) => {
    ensureAuth('花名册管理', () => {
      confirmAction('确定删除该玩家？历史对局记录将保留。', async () => {
        try {
          await api(`/api/player/${id}`, { method: 'DELETE', auth: true })
          setPlayers((prev) => prev.filter((p) => p.id !== id))
          showToast('已删除', 'success')
        } catch (e) {
          showToast(e.message, 'error')
        }
      })
    })
  }

  const add = () => {
    const name = newName.trim()
    if (!name) return
    ensureAuth('花名册管理', async () => {
      try {
        await api('/api/player', { method: 'POST', auth: true, body: JSON.stringify({ name }) })
        setNewName('')
        await load()
        showToast('已添加', 'success')
      } catch (e) {
        showToast(e.message, 'error')
      }
    })
  }

  return (
    <>
      <PageHead
        eyebrow="花名册"
        meta={`${players.length} 人`}
        title="参战名单"
        sub="点名字可直接改，回车保存"
        colors={['#F6E3B4', '#C9A44C', '#E9C87C', '#C9A44C', '#F6E3B4']}
      />

      <section className="standings">
        {players.length === 0 && (
          <div className="prize-empty">花名册为空，添加玩家开始</div>
        )}

        {/* 护栏只圈住**玩家行**，不圈底下那个「添加新玩家」的框 —— 输入框是动作、
            不是列表内容，被滚出可视区就等于加不了人（实测 12 人时它会掉到可视区
            下方 237px）。行距来自 .roster-item 自己的 margin-bottom，不是容器的
            gap，所以多包这一层不改变排版。 */}
        <div className="roster-list height-guard" ref={listRef}>
          {players.map((p) => (
            <div className="roster-item" key={p.id}>
              <Avatar url={p.avatar_url} name={p.name} className="roster-avatar" />
              <input
                value={drafts[p.id] ?? p.name}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                onBlur={() => rename(p.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
                aria-label={`${p.name} 的名字`}
              />
              <span className="roster-index">#{p.id}</span>
              <button className="roster-del" onClick={() => remove(p.id)} title="删除">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                </svg>
              </button>
            </div>
          ))}
        </div>

        <div className="addbox">
          <label className="addbox-label">添加新玩家</label>
          <div className="addbox-row">
            <input
              className="addbox-input"
              value={newName}
              placeholder="输入名字"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') add() }}
            />
            {/* 小按钮才适合磁吸：位移量 = 光标到中心的距离 / magnetStrength，
                通栏按钮半宽就有 200px+，几乎整页都在激活区，会被推着乱跑。 */}
            <Magnet
              padding={36}
              magnetStrength={5}
              style={{ position: 'relative', display: 'inline-block', flexShrink: 0 }}
            >
              <button className="btn btn-primary" onClick={add}>添加</button>
            </Magnet>
          </div>
        </div>
      </section>
    </>
  )
}
