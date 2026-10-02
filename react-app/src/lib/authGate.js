import { useAuth } from './auth'
import { getHouseKey } from './api'

// 需要房主密码的操作。
//
//   默认：本会话已鉴权（houseKey 已缓存）就直接执行 —— 连续录入不重复打断。
//   reauth: true：即使已鉴权也重新输一次，给「钱离池」这类动作单独把门。
//     缓存里的 key 只能证明「这个页面会话里有人输对过密码」，
//     不能证明「现在坐在屏幕前的人就是他」，所以支取要重新确认一次。
export function useAuthGate() {
  const { authStep } = useAuth()

  return function ensureAuth(title, fn, { reauth = false } = {}) {
    if (!reauth && getHouseKey()) {
      fn()
      return
    }
    authStep(title, fn)
  }
}
