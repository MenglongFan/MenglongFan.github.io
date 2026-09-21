import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'

// 自托管中文字体（OFL-1.1），按 unicode-range 切片，浏览器只下载用到的部分。
// 不走 Google Fonts：境内可稳定加载，也不依赖任何外部 CDN。
import '@fontsource-variable/noto-serif-sc'            // 思源宋体（正文 / 可变字重 200-900）
import 'cn-fontsource-smiley-sans-oblique-regular/font.css' // 得意黑（标题 / 比分）

import App from './App'
import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
)
