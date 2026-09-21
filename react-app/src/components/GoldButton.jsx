import Magnet from '../bits/Magnet/Magnet'
import GlareHover from '../bits/GlareHover/GlareHover'

/**
 * 通栏主行动按钮。
 *
 * 用 GlareHover 做高光扫过（移动端没有 hover，所以这个效果只在桌面出现，
 * 是加分项不是必需项）。按钮本体的金色渐变 + 投影由 .btn-cta 负责。
 *
 * 关于 Magnet：只在「小按钮」上开。
 * 磁吸位移是 (光标到中心距离 / magnetStrength)，激活半径是 半宽 + padding。
 * 通栏按钮半宽就有 200px+，加上 padding 后几乎整页都在激活区，
 * 会被推着到处跑 —— 那是坏的，不是好的。所以 magnet 默认关。
 */
export default function GoldButton({
  children,
  onClick,
  disabled = false,
  variant = 'primary',
  magnet = false,
  type = 'button',
}) {
  const button = (
    <button
      type={type}
      className={`btn btn-cta ${variant === 'gold' ? 'btn-gold' : 'btn-primary'}`}
      onClick={onClick}
      disabled={disabled}
    >
      <GlareHover
        width="100%"
        height="100%"
        background="transparent"
        borderColor="transparent"
        borderRadius="18px"
        glareColor="#FFF3D6"
        glareOpacity={0.42}
        glareAngle={-40}
        glareSize={220}
        transitionDuration={700}
        className="btn-glare"
      >
        <span>{children}</span>
      </GlareHover>
    </button>
  )

  if (!magnet) return button

  return (
    // Magnet 的包裹层是 display:inline-block，且样式写在 {...props} 之前，
    // 子元素的 width:100% 会被压成内容宽 —— 必须在 props 里显式覆盖回 block 满宽。
    <Magnet
      padding={40}
      magnetStrength={4}
      style={{ position: 'relative', display: 'block', width: '100%' }}
    >
      {button}
    </Magnet>
  )
}
