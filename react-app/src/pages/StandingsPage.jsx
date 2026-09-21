import { useState, useEffect, useCallback, useMemo } from 'react'
import { api } from '../lib/api'
import Avatar from '../components/Avatar'
import PageHead from '../components/PageHead'
import RankRow from '../components/RankRow'
import BorderGlow from '../bits/BorderGlow/BorderGlow'
import SpotlightCard from '../bits/SpotlightCard/SpotlightCard'
import CountUp from '../components/CountUp'

const Crown = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M3 18h18l-1.6-9-4.4 3.4L12 6l-3 6.4L4.6 9z" />
  </svg>
)

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

  // 相对积分条的基准。兜底 1 是为了避免除零（全 0 分时条宽 0%，视觉上正确）
  const maxScore = useMemo(
    () => standings.reduce((m, p) => Math.max(m, p.total_score || 0), 1),
    [standings]
  )

  // ---------- 加载中 ----------
  if (loading) {
    return (
      <>
        <PageHead eyebrow="积分榜" meta="读取中" title="国战积分" sub="正在同步本赛季战绩" />
        <div className="standings">
          {Array(5).fill(0).map((_, i) => (
            <div className="skeleton-row" key={i}>
              <div className="skeleton-bar skeleton-avatar" />
              <div className="skeleton-bar skeleton-name" />
              <div className="skeleton-bar skeleton-score" />
            </div>
          ))}
        </div>
      </>
    )
  }

  // ---------- 没有赛季 ----------
  if (!season) {
    return (
      <>
        <PageHead eyebrow="积分榜" meta="暂无赛季" title="国战积分" sub="还没有进行中的赛季" muted />
        <div className="standings">
          <div className="standings-empty">
            <div className="seal">令</div>
            <div className="big">尚无赛季</div>
            <div>到「赛季」页新建一个赛季开始</div>
          </div>
        </div>
      </>
    )
  }

  // ---------- 赛季已建、尚无对局 ----------
  if (standings.length === 0) {
    return (
      <>
        <PageHead
          eyebrow={season.name}
          meta={season.is_active ? '进行中' : '已结束'}
          title="国战积分"
          sub="本赛季还没有对局记录"
        />
        <div className="standings">
          <div className="standings-empty">
            <div className="seal">空</div>
            <div className="big">赛季尚未开始</div>
            <div>等待第一局录入</div>
          </div>
        </div>
      </>
    )
  }

  // 后端 /api/standings 已按 total_score DESC, survival_count DESC 排序，
  // 所以下标 0 就是榜首，榜单从下标 1 开始（第 2 名）。
  const champion = standings[0]
  const rest = standings.slice(1)

  return (
    <>
      <PageHead
        eyebrow={`${season.name}${season.is_active ? ' · 进行中' : ' · 已结束'}`}
        meta={`${standings.length} 人参战`}
        title="国战积分"
        sub="按积分排序 · 点任意一行看逐局明细"
      />

      {/* ---------- 榜首卡 ----------
          BorderGlow 的光只在 hover 时出现，移动端永远看不到。
          所以常驻 sweep-active + 钉住 --edge-proximity，让边框光缓慢环绕。 */}
      <section className="hero">
        <BorderGlow
          className="sweep-active"
          backgroundColor="#15100E"
          borderRadius={26}
          glowColor="42 72 62"
          glowRadius={46}
          glowIntensity={1.15}
          coneSpread={26}
          edgeSensitivity={26}
          colors={['#E9C87C', '#E24B36', '#C9A44C']}
        >
          <div className="hero-in">
            <div className="hero-badge">
              <Crown />
              <span>本季榜首</span>
            </div>
            <div className="hero-body">
              <Avatar url={champion.avatar_url} name={champion.name} className="hero-avatar" />
              <div className="hero-info">
                <div className="hero-name">{champion.name}</div>
                <div className="hero-meta">
                  <span>{champion.match_count} 局</span>
                  <i className="sep" />
                  <span className="gold">存活 {champion.survival_count} 次</span>
                </div>
              </div>
              <div className="hero-score">
                <CountUp
                  to={champion.total_score || 0}
                  from={0}
                  duration={1}
                  className="hero-num"
                />
                <span className="hero-unit">分</span>
              </div>
            </div>
          </div>
        </BorderGlow>
      </section>

      {/* ---------- 完整榜单 ---------- */}
      <section className="standings">
        {rest.length > 0 && (
          <div className="list-hd">
            <h2>完整战绩</h2>
            <span>共 {standings.length} 人</span>
          </div>
        )}

        {rest.length === 0 && (
          <div className="detail-note">本赛季只有 1 人有战绩</div>
        )}

        {rest.map((p, i) => {
          const rank = i + 2
          const open = expandedId === p.id
          return (
            <SpotlightCard
              key={p.id}
              className={`rank-item rank-${rank} ${open ? 'is-open' : ''}`}
              spotlightColor="rgba(233,200,124,0.16)"
              role="button"
              tabIndex={0}
              aria-expanded={open}
              onClick={() => toggleDetail(p.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  toggleDetail(p.id)
                }
              }}
            >
              <RankRow player={p} rank={rank} maxScore={maxScore} animateIndex={i} />

              <div className={`rank-detail ${open ? 'show' : ''}`}>
                {open && (
                  details[p.id] === undefined ? (
                    <div className="detail-note">加载中...</div>
                  ) : details[p.id].length === 0 ? (
                    <div className="detail-note">暂无对局记录</div>
                  ) : (
                    details[p.id].map((d) => (
                      <div className="detail-row" key={d.id}>
                        <span className="d-left">
                          <span className={`stamp ${d.is_survivor ? 'alive' : 'dead'}`}>
                            {d.is_survivor ? '存' : '亡'}
                          </span>
                          <span className="d-date">
                            {d.played_at ? d.played_at.slice(5, 16).replace('T', ' ') : '—'}
                          </span>
                        </span>
                        <span className="d-rank">第 {d.rank} 名</span>
                        <span className="score-val">{d.score}分</span>
                      </div>
                    ))
                  )
                )}
              </div>
            </SpotlightCard>
          )
        })}
      </section>
    </>
  )
}
