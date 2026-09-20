import { useState, useEffect, useRef } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useAuthGate } from '../lib/authGate'
import Avatar from '../components/Avatar'

function WithdrawForm({ submitRef }) {
  const [amount, setAmount] = useState('')
  const [desc, setDesc] = useState('')
  submitRef.current = () => ({ amount: parseFloat(amount), description: desc.trim() })
  return (
    <>
      <div className="withdraw-hint">请核对奖池余额后再支取。</div>
      <div className="form-group">
        <label className="form-label">支取金额（元）</label>
        <input className="form-input" type="number" min="0.01" step="0.01" value={amount} placeholder="输入金额" onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">用途说明</label>
        <input className="form-input" value={desc} placeholder="如：聚餐、采购等" onChange={(e) => setDesc(e.target.value)} />
      </div>
    </>
  )
}

export default function PrizePage() {
  const { showToast, setModalContent, closeModal } = useAuth()
  const ensureAuth = useAuthGate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const withdrawRef = useRef(null)

  const load = async () => {
    setLoading(true)
    try {
      setData(await api('/api/prize-pool/summary'))
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const openWithdraw = async () => {
    ensureAuth('支取奖池', async () => {
      try {
        const summary = await api('/api/prize-pool/summary')
        if (summary.current_balance <= 0) {
          showToast('奖池余额为零，无法支取', 'error')
          return
        }
        setModalContent('支取奖池',
          <WithdrawForm submitRef={withdrawRef} />,
          <>
            <button className="btn btn-ghost" onClick={() => { closeModal(); load() }}>返回</button>
            <button className="btn btn-primary" onClick={async () => {
              const { amount, description } = withdrawRef.current ? withdrawRef.current() : { amount: 0, description: '' }
              if (!amount || amount <= 0) { showToast('请输入有效金额', 'error'); return }
              try {
                await api('/api/prize-pool/withdraw', { method: 'POST', auth: true, body: JSON.stringify({ amount, description }) })
                showToast('支取成功', 'success')
                closeModal()
                await load()
              } catch (e) { showToast(e.message, 'error') }
            }}>确认支取</button>
          </>)
      } catch (e) {
        showToast(e.message, 'error')
      }
    })
  }

  if (loading) {
    return <div className="standings-empty"><div className="big">加载中...</div></div>
  }

  if (!data) {
    return <div className="standings-empty"><div className="seal">赏</div><div className="big">奖池</div><div>加载失败</div></div>
  }

  const { current_balance, contributions, recent_transactions } = data

  return (
    <div className="standings">
      <div className="prize-total">
        <div className="label">公共基金池</div>
        <div className="amount">{current_balance}<span className="yuan">元</span></div>
      </div>

      <div className="prize-section">
        <div className="prize-section-title">
          <span>贡献榜</span>
          <span className="count">{contributions.length}人</span>
        </div>
        {contributions.length > 0 ? (
          <div className="contribution-list">
            {contributions.map((c, i) => (
              <div className="contribution-item" key={c.id}>
                <span className="contrib-rank">{i + 1}</span>
                <Avatar url={c.avatar_url} name={c.name} className="contrib-avatar" />
                <span className="contrib-name">{c.name}</span>
                <span className="contrib-amount">{c.total_amount}元</span>
              </div>
            ))}
          </div>
        ) : <div className="prize-empty">暂无贡献记录</div>}
      </div>

      <div className="prize-section">
        <div className="prize-section-title">
          <span>流水</span>
          <span className="count">最近{recent_transactions.length}条</span>
        </div>
        {recent_transactions.length > 0 ? (
          <div className="tx-list">
            {recent_transactions.map((t) => {
              const isPositive = t.amount > 0
              const typeLabel = t.type === 'fine' ? '罚金入账' : '支取'
              const desc = t.type === 'fine'
                ? (t.season_name || '赛季罚金') + ' · ' + (t.player_name || '')
                : (t.description || '支取')
              return (
                <div className="tx-item" key={t.id}>
                  <div className="tx-info">
                    <span className={`tx-type ${t.type}`}>{typeLabel}</span>
                    <div className="tx-desc">{desc}</div>
                  </div>
                  <div className="tx-amount">
                    <span className={`val ${isPositive ? 'positive' : 'negative'}`}>{isPositive ? '+' : ''}{t.amount}元</span>
                    <span className="balance">余额 {t.balance}元</span>
                  </div>
                </div>
              )
            })}
          </div>
        ) : <div className="prize-empty">暂无流水记录</div>}
      </div>

      {current_balance > 0 && (
        <button className="btn btn-gold" style={{ width: '100%', justifyContent: 'center', marginTop: 16 }} onClick={openWithdraw}>
          支取奖池
        </button>
      )}
    </div>
  )
}
