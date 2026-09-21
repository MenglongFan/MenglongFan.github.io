import Avatar from './Avatar'
import CountUp from './CountUp'

/**
 * 榜单行内容（不含外层卡片）。
 *
 * 积分榜和「赛季 → 查看」两处要渲染完全一样的一行，抽出来保证不会各自漂移。
 * 外层卡片由调用方决定：积分榜用 SpotlightCard（带聚光 + 可展开），
 * 赛季查看用 .rank-item-static（纯静态玻璃块）。
 */
export default function RankRow({ player, rank, maxScore = 1, animateIndex = 0 }) {
  const pct = Math.round(((player.total_score || 0) / maxScore) * 100)
  return (
    <div
      className="rank-row"
      style={animateIndex ? { animationDelay: `${animateIndex * 0.06}s` } : undefined}
    >
      <span className="rank-no">{rank}</span>
      <Avatar url={player.avatar_url} name={player.name} className="rank-avatar" />
      <div className="rank-info">
        <div className="rank-name">{player.name}</div>
        <div className="rank-meta">
          <span>{player.match_count} 局</span>
          <i className="sep" />
          <span className="survival">存活 {player.survival_count} 次</span>
        </div>
      </div>
      <span className="rank-bar" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </span>
      <span className="rank-score">
        <CountUp to={player.total_score || 0} from={0} duration={0.7} />
        <span className="unit">分</span>
      </span>
    </div>
  )
}
