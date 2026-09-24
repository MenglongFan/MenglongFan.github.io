import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'

gsap.registerPlugin(useGSAP)

/**
 * 页面切换的入场编排。
 *
 * 为什么用 GSAP 而不是再加一段 CSS @keyframes：这里要的是**有先后顺序的一串**动效
 * ——页头三行依次浮现，内容块再错峰跟上。CSS 只能让每个元素各自延时，顺序一旦调整
 * 就要重算每个 delay，且没法中途接管。GSAP 的时间线天然表达「谁在谁之后」。
 *
 * 四条边界（前三条是踩过或差点踩的）：
 *
 * 1. **绝不给 .page-content 本身加 transform。** 奖池的账单浮层（.bill-overlay）
 *    是它的直接子节点且是 position:fixed —— 视口定位。父级一旦有 transform，
 *    它的包含块就从视口变成那个父级，账单就贴不到屏幕顶边了。
 *    所以只动 .page-head 与各个 <section>，它们是账单的**兄弟**，不是祖先。
 *    同理，账单本身也排除在动画目标之外。收尾还 clearProps 把内联 transform 摘掉，
 *    不给以后往这些块里放 fixed 元素的人埋雷。
 *
 * 2. **用 fromTo，不用 from。** from 的终点取「元素当前的值」，重复播放会把上一次
 *    被打断的中间值当成终点 —— 实测 section 最后停在 opacity:0 / visibility:hidden /
 *    translateY(15px)，整块看不见也点不动（余额双击打不开账单）。fromTo 把终点写死。
 *
 * 3. **每个元素只入场一次**（下面的 WeakSet）。页面「加载中 → 有数据」时顶层块会换，
 *    但页头是同一个 DOM 节点。不记的话页头会先淡入一次、数据到位后又弹回 0 重来一遍。
 *
 * 4. **只动 transform 与 opacity，不动 width/height/top/margin。** transform 不参与布局，
 *    实测动画期间 document.scrollHeight 与视口宽度全程不变 —— 这是「永远不要出现滚动条」
 *    那条要求的直接约束。
 *
 * 触发靠 MutationObserver 而不是路由：页面「加载中 → 有数据」时路由没变，但顶层块
 * 从 <div> 换成了 <section>。监听直接子节点（subtree:false）同时覆盖「切页」和
 * 「数据到位」。监听同步跑（微任务里、绘制之前），不会先闪一帧完整内容再把它压回透明。
 */
export default function PageTransition({ children }) {
  const scope = useRef(null)

  useGSAP(() => {
    const root = scope.current
    if (!root) return

    const mm = gsap.matchMedia()

    // 尊重系统的「减弱动态效果」。不匹配时**什么都不做** ——
    // 元素保持原样可见，而不是变成 opacity:0 卡住。
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const played = new WeakSet()   // 已经入场过的元素
      const timelines = []

      // 收尾把内联样式摘干净：GSAP 会在元素上留下 transform（哪怕是单位矩阵），
      // 而 transform 会给 position:fixed 的后代换一个包含块。清掉就没有这个隐患。
      const CLEAR = 'transform,translate,rotate,scale,opacity,visibility'

      const play = () => {
        const head = root.querySelector('.page-head')
        const blocks = [...root.children].filter(
          (el) => el !== head && !el.classList.contains('bill-overlay')
        )

        const freshHead = head ? [...head.children].filter((el) => !played.has(el)) : []
        const freshBlocks = blocks.filter((el) => !played.has(el))
        if (!freshHead.length && !freshBlocks.length) return
        freshHead.forEach((el) => played.add(el))
        freshBlocks.forEach((el) => played.add(el))

        const tl = gsap.timeline()
        timelines.push(tl)

        // 页头：药丸行 → 主标题 → 副标题，依次浮现
        if (freshHead.length) {
          tl.fromTo(
            freshHead,
            { autoAlpha: 0, y: 12 },
            {
              autoAlpha: 1, y: 0, duration: 0.4, stagger: 0.05,
              ease: 'power3.out', clearProps: CLEAR,
            }
          )
        }

        // 内容块：错峰落下，和页头尾段重叠，整体控制在 0.8 秒内。
        // 页头已经入场过时（数据到位那一次）就直接从 0 开始，不再往后压。
        if (freshBlocks.length) {
          tl.fromTo(
            freshBlocks,
            { autoAlpha: 0, y: 24 },
            {
              autoAlpha: 1, y: 0, duration: 0.52, stagger: 0.07,
              ease: 'power3.out', clearProps: CLEAR,
            },
            freshHead.length ? '-=0.3' : 0
          )
        }
      }

      play()

      const mo = new MutationObserver(play)
      mo.observe(root, { childList: true })

      return () => {
        mo.disconnect()
        timelines.forEach((t) => t.kill())
      }
    })

    return () => mm.revert()
  }, { scope })

  return (
    <div className="page-content" ref={scope}>
      {children}
    </div>
  )
}
