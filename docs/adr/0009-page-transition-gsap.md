# ADR 0009: 页面入场编排用 GSAP 时间线，并划定四条不可越过的边界

**状态**: 已接受
**日期**: 2026-09-24

## 背景

这个 SPA 的动效原本来自两处：react-bits 组件（`ClickSpark` / `DarkVeil` / `GlareHover` /
`Magnet` / `SpotlightCard`）和 `global.css` 里 13 段 `@keyframes`，另有自己写的 `CountUp`。
它们覆盖的都是**单个元素自己的**动效。

缺的是**有先后顺序的一串**：切到某个 tab 时，页头三行先依次浮现，内容块再错峰跟上。
用 CSS 做这件事只能给每个元素各写一个 `animation-delay`，代价是：

- 顺序一改，每个 delay 都要重算；
- 元素个数随数据变化（总榜 5 人还是 10 人）时，delay 是写死的；
- 中途想接管（比如数据晚到）没有办法。

## 决策

引入 `gsap` 3.15.0 + `@gsap/react` 2.1.2，新增 `src/components/PageTransition.jsx`
接管 `.page-content`，由它编排页头与顶层内容块的入场。

1. **用 `useGSAP()`**（`@gsap/react`），传 `scope`，并在文件顶部
   `gsap.registerPlugin(useGSAP)`。清理由它负责，不再手写 `useEffect` 的收尾。
2. **用 `gsap.matchMedia()` 包住整段**，查询是 `(prefers-reduced-motion: no-preference)`。
   不匹配时**什么都不做** —— 元素保持原样可见，而不是变成 `opacity:0` 卡住。
3. **触发靠 `MutationObserver({childList:true})` 监听 `.page-content` 的直接子节点**，
   而不是监听路由。因为「切页」和「加载中 → 数据到位」是两件事：后者路由没变，
   但顶层块从 `<div>` 换成了 `<section>`。一个监听同时覆盖两者。
   监听回调跑在微任务里、绘制之前，所以不会先闪一帧完整内容再把它压回透明。
4. **`fromTo` 而不是 `from`。** `from` 的终点取「元素当前的值」。
5. **`clearProps: 'transform,translate,rotate,scale,opacity,visibility'` 收尾**，
   不让任何内联样式留在 DOM 上。
6. **只动 `transform` 与 `opacity`**，不动 `width` / `height` / `top` / `margin`。

## 四条边界

前三条是踩过或差点踩的，写在这里是因为它们都不是「风格问题」，是**功能性约束**。

### 1. 绝不给 `.page-content` 本身加 transform

奖池的账单浮层 `.bill-overlay` 是 `.page-content` 的**直接子节点**，且是 `position:fixed`
—— 视口定位。父级一旦有 `transform`（`will-change: transform` / `filter` 同样），
它的包含块就从视口变成那个父级，账单再也贴不到屏幕顶边。

所以动画只作用于 `.page-head` 与各个 `<section>`，它们是账单的**兄弟**，不是祖先；
账单本身也排除在目标之外。收尾再 `clearProps` 把内联 transform 摘掉，
不给以后往这些块里放 fixed 元素的人埋雷。

验证：`.bill-overlay` 的 `position` 仍是 `fixed`，`overlayTop=0`、`overlayLeft=0`、
`overlayWidth=390`（390 宽视口下满宽，没有少 15px 的那条亮边）。

### 2. 用 `fromTo`，不用 `from`

`from` 把元素**当前的值**当作终点。页面有两次触发（首屏、数据到位），两次动画重叠时
前一个被打断、`kill()` 掉，元素就停在那个中间值上 —— 实测 section 最后停在
`opacity:0; visibility:hidden; transform: translateY(15px)`，整块看不见也点不动
（双击余额打不开账单，`elementFromPoint` 返回的是 `.page-content`）。
`fromTo` 把终点写死，打断多少次终点都不变。

### 3. 每个元素只入场一次

页面「加载中 → 有数据」时顶层块会换，但**页头是同一个 DOM 节点**。不记录的话
页头先淡入一次，数据到位后又弹回 0 重来一遍。用一个 `WeakSet` 记已入场的元素，
后一次 `play()` 只处理新插入的节点，且块动画从位置 `0` 开始而不是 `'-=0.3'`。

### 4. 只动 transform / opacity，保证不出滚动条

用户要求「永远不要出现滚动条」。`transform` 不参与布局，所以动画在物理上不可能改变
`document.scrollHeight` —— 这是把「不动 width/height/top/margin」写成硬约束的原因，
不是审美选择。

验证：390×844 下五条路由逐条核对，`/` `/match` `/season` `/prize` 全部
`docH = winH = 844`；`/roster` 是 `docH=850`，这 6px 是**改造前就有的**（无动画的
纯加载同样 850），不是动画带来的。

## 代价

| | 改造前 | 改造后 |
| --- | --- | --- |
| JS | `index-MUM6n1HT.js` 273.72 kB / gzip 89.83 kB | `index-Q9V47GQ2.js` 346.52 kB / gzip 118.61 kB |
| CSS | `index-CGEm4ujo.css` 254.70 kB | **同一个 hash，未变** |

**+28.8 kB gzip。** CSS 的 hash 没变，是「没有改动任何既有视觉样式」的直接证据。

试过 `import gsap from 'gsap/gsap-core'` + 单独 `CSSPlugin` 的精简导入，
产物**完全一致**（同样 346.52 kB / 118.61 kB）—— 因为 `useGSAP` 本身会把完整的
`gsap` 入口拉进来，tree-shaking 减不掉。所以最终用官方推荐的 `import gsap from 'gsap'`。

## 备选方案与为什么不选

- **纯 CSS `@keyframes` + 逐元素 `animation-delay`**：顺序一改就要重算全部 delay，
  元素个数随数据变化时没法写，中途无法接管。
- **`framer-motion`**：能力足够，但体积更大，且这个项目只需要「一次性的入场编排」，
  不需要布局动画 / 手势 / 共享元素。
- **不引入库，手写 `requestAnimationFrame`**：等于自己实现时间线、错峰、清理、
  被打断时的状态收口 —— 也就是把上面第 2、3 条坑再踩一遍。

## 没有做的事

- **列表行级错峰**（`.rank-row` / `.roster-item` / `.season-item`）没有加。
  `.rank-row` 已经有一条 `animation: slideIn .5s … backwards`，再加一层 GSAP
  要改冻结中的 CSS，且行数随赛季人数变化、与 `CountUp` 的 rAF 会叠加。
  收益不明确，先不做。
- 没有用 ScrollTrigger —— 这个 SPA 里没有滚动驱动的动效需求。
