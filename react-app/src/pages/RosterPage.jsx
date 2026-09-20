import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useAuthGate } from '../lib/authGate'
import Avatar from '../components/Avatar'

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
    <div className="standings">
      <h2 className="modal-title" style={{ margin: '8px 4px 16px' }}>花名册</h2>

      {players.length === 0 && (
        <div className="prize-empty">花名册为空，添加玩家开始</div>
      )}

      {players.map((p) => (
        <div className="roster-item" key={p.id}>
          <Avatar url={p.avatar_url} name={p.name} className="roster-avatar" />
          <input
            value={drafts[p.id] ?? p.name}
            onChange={(e) => setDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
            onBlur={() => rename(p.id)}
            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
          />
          <button className="roster-del" onClick={() => remove(p.id)} title="删除">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
          </button>
        </div>
      ))}

      <div style={{ marginTop: 20 }}>
        <div className="form-group">
          <label className="form-label">添加新玩家</label>
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              className="form-input"
              value={newName}
              placeholder="输入名字"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') add() }}
            />
            <button className="btn btn-primary" onClick={add}>添加</button>
          </div>
        </div>
      </div>
    </div>
  )
}
