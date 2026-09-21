import { useEffect, useRef, useState } from 'react'

/**
 * 数字滚动。
 *
 * 刻意**不用** motion/react 的 CountUp：motion 这个包 gzip 就有 47 KB，
 * 而这里需要的只是一个缓动计数器。自己写 30 行，整包省掉。
 *
 * 两个细节：
 * - 用 IntersectionObserver 触发，滚动到才播，避免离屏元素空跑。
 * - 进度按 performance.now() 的真实耗时算，所以即使帧率很低（headless 里 rAF
 *   被压到 ~1fps），第二帧就直接落到终值，不会卡在中间态。
 */
export default function CountUp({
  to,
  from = 0,
  duration = 1,
  className = '',
  decimals,
}) {
  const ref = useRef(null)
  const [val, setVal] = useState(from)
  const startedRef = useRef(false)

  // 整数就用 0 位小数，出现小数就保留 1 位（奖池余额会是 12.5 这种）
  const places =
    decimals !== undefined
      ? decimals
      : Number.isInteger(to) && Number.isInteger(from)
        ? 0
        : 1

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0

    const run = () => {
      if (startedRef.current) return
      startedRef.current = true
      const t0 = performance.now()
      const tick = (now) => {
        const t = Math.min((now - t0) / (duration * 1000), 1)
        if (t >= 1) {
          setVal(to)
          return
        }
        setVal(from + (to - from) * (1 - Math.pow(1 - t, 3)))
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }

    if (typeof IntersectionObserver === 'undefined') {
      run()
      return () => cancelAnimationFrame(raf)
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        run()
        io.disconnect()
      }
    })
    io.observe(el)
    return () => {
      io.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [to, from, duration])

  return (
    <span ref={ref} className={className}>
      {val.toFixed(places)}
    </span>
  )
}
