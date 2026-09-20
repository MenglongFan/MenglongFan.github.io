import { useState } from 'react'

// 复刻 scoring.html 的 avatarImg：有头像图则渲染 img + 隐藏占位符（加载失败回退首字），否则只渲染首字占位
export default function Avatar({ url, name, className = '' }) {
  const [err, setErr] = useState(false)
  const initial = name ? name.charAt(0) : '?'

  if (url && !err) {
    return (
      <div className={className}>
        <img src={url} alt={name} onError={() => setErr(true)} />
        <div className="avatar-placeholder" style={{ display: 'none' }}>{initial}</div>
      </div>
    )
  }

  return (
    <div className={className}>
      <div className="avatar-placeholder">{initial}</div>
    </div>
  )
}
