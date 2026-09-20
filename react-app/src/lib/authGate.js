import { useAuth } from './auth'
import { getHouseKey } from './api'

// 需要房主密码的操作：若本会话已鉴权（houseKey 已缓存）则直接执行，否则弹密码框
export function useAuthGate() {
  const { authStep } = useAuth()

  return function ensureAuth(title, fn) {
    if (getHouseKey()) {
      fn()
      return
    }
    authStep(title, fn)
  }
}
