import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import Avatar from '../components/Avatar'

export default function StandingsPage() {
  const [season, setSeason] = useState(null)
  const [standings, setStandings] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  const [details, setDetails] = useState({}) // playerId -> details[]

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api('/api/standings')
      setSeason(data.season)
      setStandings(data.standings || [])
    } catch (e) {
      setSeason(null)
      setStandings([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const toggleDetail = async (playerId) => {
    if (expandedId === playerId) {
      setExpandedId(null)
      return
    }
    setExpandedId(playerId)
    if (details[playerId] || !season) return
    try {
      const data = await api(`/api/player/${playerId}/details?season_id=${season.id}`)
      setDetails((prev) => ({ ...prev, [playerId]: data.details || [] }))
    } catch {
      setDetails((prev) => ({ ...prev, [playerId]: [] }))
    }
  }

  if (loading) {
    return (
      <div className="standings">
        {Array(5).fill(0).map((_, i) => (
          <div className="skeleton-row" key={i}>
            <div className="skeleton-bar skeleton-avatar" />
            <div className="skeleton-bar skeleton-name" />
            <div className="skeleton-bar skeleton-score" />
          </div>
        ))}
      </div>
    )
  }

  if (!season) {
    return (
      <div className="standings">
        <div className="standings-empty">
          <div className="seal">令</div>
          <div className="big">尚无赛季</div>
          <div>到「赛季」页新建一个赛季开始</div>
        </div>
      </div>
    )
  }

  if (standings.length === 0) {
    return (
      <div className="standings">
        <div className="standings-empty">
          <div className="seal">空</div>
          <div className="big">赛季尚未开始</div>
          <div>等待第一局录入</div>
        </div>
      </div>
    )
  }

  return (
    <div className="standings">
      {standings.map((p, i) => (
        <div key={p.id}>
          <div
            className={`rank-row ${expandedId === p.id ? 'expanded' : ''}`}
            style={{ animationDelay: `${i * 0.06}s` }}
            onClick={() => toggleDetail(p.id)}
          >
            <div className="rank-avatar">
              <div className="rank-seal">{i + 1}</div>
              <Avatar url={p.avatar_url} name={p.name} />
            </div>
            <div className="rank-info">
              <div className="rank-name">{p.name}</div>
              <div className="rank-meta">
                <span>{p.match_count}局</span>
                <span className="sep">·</span>
                <span className="survival">存活{p.survival_count}次</span>
              </div>
            </div>
            <div className="rank-score">{p.total_score}<span className="unit">分</span></div>
          </div>
          <div className={`rank-detail ${expandedId === p.id ? 'show' : ''}`}>
            {expandedId === p.id && (
              details[p.id] === undefined
                ? <div style={{ textAlign: 'center', color: 'var(--paper-mute)', padding: 12, fontFamily: 'var(--font-label)', fontSize: 12 }}>加载中...</div>
                : details[p.id].length === 0
                  ? <div style={{ color: 'var(--paper-mute)', fontSize: 12, textAlign: 'center', padding: 8, fontFamily: 'var(--font-label)' }}>暂无对局记录</div>
                  : details[p.id].map((d) => (
                      <div className="detail-row" key={d.id}>
                        <span>
                          <span className={`stamp ${d.is_survivor ? 'alive' : 'dead'}`}>{d.is_survivor ? '存' : '亡'}</span>
                          {d.played_at ? d.played_at.slice(5, 16).replace('T', ' ') : '—'}
                          <span className="sep">·</span>第{d.rank}名
                        </span>
                        <span className="score-val">{d.score}分</span>
                      </div>
                    ))
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
