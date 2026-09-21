/**
 * 页头。每页自带，取代原来 App.jsx 里那个全站共用的 .header。
 *
 * eyebrow —— 左上角药丸里的短标签（赛季名 / 分区名）
 * meta    —— 右上角的次要信息（日期 / 人数）
 * title   —— 主标题，流光渐变（纯 CSS，见 .grad-text）
 * sub     —— 副标题，高光扫过（纯 CSS，见 .shiny）
 * muted   —— 标题走低饱和渐变、药丸圆点不脉冲，用于"暂无赛季"这类状态
 *
 * 标题/副标题的动效刻意不用 react-bits 的 GradientText / ShinyText：
 * 那两个组件都依赖 motion/react（整包 47 KB gzip），而它们做的只是
 * background-position 动画 —— CSS @keyframes 就能做，零 JS 开销。
 * 顺带把 GradientText 外层的 div 也去掉了，<h1> 里不再嵌 div。
 */
export default function PageHead({ eyebrow, meta, title, sub, muted = false }) {
  return (
    <header className="page-head">
      <div className="hd-row">
        <span className={muted ? 'chip muted' : 'chip'}>
          <i className="chip-dot" />
          {eyebrow}
        </span>
        {meta ? <span className="hd-date">{meta}</span> : null}
      </div>

      <h1 className={muted ? 'hd-title grad-text dim' : 'hd-title grad-text'}>{title}</h1>

      <p className="hd-sub">{sub ? <span className="shiny">{sub}</span> : null}</p>
    </header>
  )
}
