import { Component, useMemo } from 'react'
import DarkVeil from '../bits/DarkVeil/DarkVeil'

/* DarkVeil 用 ogl 建 WebGL 上下文。失败时它会在 useEffect 里抛错，
   而 React 里 effect 抛错会**连带卸载整棵树** —— 结果就是白屏、#root 空掉。
   所以双重保护：① 渲染前探测 WebGL 能力；② 套 ErrorBoundary 兜底。 */
function hasWebGL() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl') || c.getContext('experimental-webgl'))
  } catch {
    return false
  }
}

class SafeCanvas extends Component {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err) {
    console.warn('[Backdrop] 背景渲染失败，已降级为纯色底：', err?.message)
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

export default function Backdrop() {
  // 只在挂载时判定一次：系统开了"减少动态效果"就不启动 WebGL 循环
  const enabled = useMemo(() => {
    if (typeof window === 'undefined') return false
    try {
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false
    } catch {
      /* matchMedia 不可用时按不支持处理 */
    }
    return hasWebGL()
  }, [])

  return (
    <>
      {/* ① 流体底：鎏金暖调。
          resolutionScale 压到 0.7 —— 这个片元着色器是个 CPPN，逐像素成本很高，
          而它上面还盖着 0.6 不透明度 + 一层厚渐晕，降采样肉眼看不出来。 */}
      <div className="veil">
        {enabled && (
          <SafeCanvas>
            <DarkVeil
              hueShift={-150}
              noiseIntensity={0.035}
              scanlineIntensity={0.015}
              speed={0.3}
              scanlineFrequency={0.55}
              warpAmount={0.07}
              resolutionScale={0.7}
            />
          </SafeCanvas>
        )}
      </div>
      {/* ② 颗粒 */}
      <div className="grain" />
      {/* ③ 渐晕 */}
      <div className="vignette" />
    </>
  )
}
