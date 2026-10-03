import { useLayoutEffect } from 'react'

// 高度护栏：给「行数会随数据增长的区域」一个**按视口算出来的**上限，
// 超出的部分在区内滚，页面本身永远不出现滚动条。
//
// 用户要求「永远不要出现滚动条」（ADR 0009）。但榜单/花名册这类列表的行数是随
// 人数增长的，固定高度迟早被顶破。三处用同一套实现：奖池页两块榜、积分榜、花名册。
//
// 上限必须**从视口往下减**，不能读 el.clientHeight —— 那是自指的：
// 上限改小 → 区变矮 → 下次算出来更小，一路棘轮到下限，而且这个错值自洽、不会自己回来
// （赛季详情踩过）。这里减的两段都不含区域自身的高度：
//   before = 区域顶边到文档顶
//   after  = 区域底边到页脚底
// after 对上限几乎不变（区域压矮多少，下面的页脚就跟着上移多少），所以反复计算会
// 收敛到一个固定点。说「几乎」是有实测依据的：未裁剪 312px → 裁剪后 313px，差 1px
// 来自 offsetHeight 取整（布局是小数、offsetHeight 是整数）；但连发 25 次 resize
// 稳定在 313px 不再动 —— 跳一次就停，不是每轮都掉。
//
// 用 offsetTop/offsetHeight 而不是 getBoundingClientRect()：页面入场动画
// （PageTransition 的 GSAP）会给祖先加 transform，rect 量到的是被变换过的值。
//
// 配套 CSS 在 .height-guard（global.css）：max-height + 不画滚动条 + 底部渐隐。
// 不溢出时上限够不着、也不挂 mask，外观与没有这层完全一致。
const MIN_CAP = 180   // ≈ 列表标题 + 3 行；低于这个数内滚也没法用了

export function useHeightGuard(ref, deps = []) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const setAttr = (k, v) => { if (el.dataset[k] !== v) el.dataset[k] = v }
    const syncFade = () => {
      const over = el.scrollHeight - el.clientHeight
      setAttr('overflow', over > 2 ? '1' : '0')
      setAttr('atEnd', over > 2 && el.scrollTop < over - 2 ? '0' : '1')
    }

    // 沿 offsetParent 链累加，得到相对文档的纵向偏移（同一参照系，且不受 transform 影响）
    const offTop = (n) => { let y = 0, x = n; while (x) { y += x.offsetTop; x = x.offsetParent } return y }

    const fit = () => {
      const footer = document.querySelector('.footer')
      if (!footer) return                       // 量不到就不设上限，退回「不裁剪」的旧行为
      const before = offTop(el)
      const after = offTop(footer) + footer.offsetHeight - (offTop(el) + el.offsetHeight)
      const avail = window.innerHeight - before - after
      // 视口矮到「区域之外的内容」自己就快占满时（笔记本 1366×768、或窗口压得很矮），
      // avail 会趋近甚至变成负数。这时**绝不能**照算：把上限设成 0 会让整个区域
      // 高度归零、直接看不见 —— 比页面滚动糟得多。护栏的职责是别让页面滚，
      // 不是把用户要看的东西藏起来，所以这种情况退回「不裁剪」，让页面正常滚。
      if (avail >= MIN_CAP) el.style.setProperty('--guard-max', avail + 'px')
      else el.style.removeProperty('--guard-max')
      syncFade()
    }

    fit()
    el.addEventListener('scroll', syncFade, { passive: true })
    window.addEventListener('resize', fit)

    // 内容自己长高（多一行、或字体加载完）不会触发上面任何一条：被上限截住之后
    // el 的盒子就固定了，既没有 resize、也不会引起自己的尺寸变化。
    // 所以要盯它的**子节点**，不是它自己。加了行就重新挂一次观察对象。
    const ro = new ResizeObserver(syncFade)
    const observeKids = () => { ro.disconnect(); for (const k of el.children) ro.observe(k) }
    const mo = new MutationObserver(() => { observeKids(); syncFade() })
    observeKids()
    mo.observe(el, { childList: true })

    return () => {
      el.removeEventListener('scroll', syncFade)
      window.removeEventListener('resize', fit)
      ro.disconnect()
      mo.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
