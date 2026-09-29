// 从源码里切出**未导出**的函数来测试的共用助手。
//
// 为什么不 import、也不在测试里重写一份：
//   - 目标函数没有 export，import 拿不到；
//   - 在测试里重写一遍算法，测的就是测试里那份 —— 实现改了、测试照样绿，等于没测。
// 切源码能保证跑的就是线上那份代码。
//
// 代价是源码结构不能乱动：下面这些锚点字符串一旦消失或顺序颠倒，这里**直接报错退出**，
// 而不是静默跳过。静默跳过的测试比没有测试更糟 —— 它给出一片虚假的绿。
//
// 为什么报错走 console.error + process.exit 而不是 throw：
//   本仓库的测试是 `node <文件>.mjs` 直接跑的独立脚本，没有测试框架兜底。
//   而且从第一个消费方（罚金算法测试）沿用下来的就是这个形态，
//   抽成助手时保持一致，免得「顺手改顺手」把输出格式也一起改了。

import { readFileSync } from 'node:fs'

/** 本助手所在目录（worker/test/）。所有测试都在这一层，所以默认路径相对它解析。 */
const TEST_DIR = new URL('./', import.meta.url)

/**
 * 把源码里 [from, to) 这一段切出来，在其中取出名为 fn 的函数并返回。
 *
 * @param {object} opts
 * @param {string} opts.from   切片起点（包含）
 * @param {string} opts.to     切片终点（不包含）
 * @param {string} opts.fn     要从切片里取出的函数名
 * @param {string} [opts.file='../src/index.js'] 源码文件，相对 worker/test/ 解析
 * @param {string} [opts.label] 报错里显示的文件名，默认取 file 本身
 * @returns {Function}
 */
export function spliceFunction({ from, to, fn, file = '../src/index.js', label }) {
  const src = readFileSync(new URL(file, TEST_DIR), 'utf8')
  const start = src.indexOf(from)
  const end = src.indexOf(to)
  if (start < 0 || end < 0 || end <= start) {
    // 消息保持和抽助手之前逐字一致 —— 锚点在调用处就写着，不需要在报错里再抄一遍
    console.error(`切不出 ${fn} —— ${label || file} 的锚点变了，请同步更新本测试`)
    process.exit(1)
  }
  return new Function(`${src.slice(start, end)}; return ${fn}`)()
}
