import { useState, useEffect, useRef } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useAuthGate } from '../lib/authGate'
import Avatar from '../components/Avatar'
import PageHead from '../components/PageHead'
import GoldButton from '../components/GoldButton'
import CountUp from '../components/CountUp'

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
  // 流水默认折叠，只露前几条；展开后列表限高内滚（见 .fold-wrap）
  const [txOpen, setTxOpen] = useState(false)
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
    return (
      <>
        <PageHead eyebrow="奖池" meta="读取中" title="罚金奖池" sub="正在同步奖池余额" />
        <div className="standings-empty"><div className="big">加载中...</div></div>
      </>
    )
  }

  if (!data) {
    return (
      <>
        <PageHead eyebrow="奖池" meta="读取失败" title="罚金奖池" sub="稍后重试" muted />
        <div className="standings-empty">
          <div className="seal">赏</div>
          <div className="big">奖池</div>
          <div>加载失败</div>
        </div>
      </>
    )
  }

  const { current_balance, contributions, recent_transactions } = data

  // 折叠阈值：超过这个条数才值得折叠。3 条以内直接全展示，不做多余的交互。
  const TX_PREVIEW = 3
  const canFold = recent_transactions.length > TX_PREVIEW
  const txVisible = canFold && !txOpen
    ? recent_transactions.slice(0, TX_PREVIEW)
    : recent_transactions
  // 可折叠时标题整行就是开关（带箭头）；不可折叠时退化成普通 div，避免出现点了没反应的按钮
  const TitleTag = canFold ? 'button' : 'div'

  return (
    <>
      <PageHead
        eyebrow="奖池"
        meta={`${contributions.length} 人 · ${recent_transactions.length} 笔`}
        title="罚金奖池"
        sub="末尾三名罚金累积 · 跨赛季滚存"
      />

      <section className="standings">
        <div className="prize-total">
          <div className="label">公共基金池</div>
          <div className="amount">
            <CountUp to={current_balance || 0} from={0} duration={1.2} />
            <span className="yuan">元</span>
          </div>
        </div>

        <div className="prize-section">
          <div className="prize-section-title">
            <span>贡献榜</span>
            <span className="count">{contributions.length} 人</span>
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
          <TitleTag
            {...(canFold
              ? { type: 'button', onClick: () => setTxOpen((v) => !v), 'aria-expanded': txOpen }
              : {})}
            className={`prize-section-title${canFold ? ' as-btn' : ''}`}
          >
            <span>流水</span>
            <span className="count">
              最近 {recent_transactions.length} 条
              {canFold && <i className="chev" />}
            </span>
          </TitleTag>
          {recent_transactions.length > 0 ? (
            <>
              <div className={`fold-wrap${canFold && !txOpen ? ' folded' : ' open'}`}>
                <div className="tx-list fold-scroll">
                  {txVisible.map((t) => {
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
              </div>
              {canFold && (
                <button
                  type="button"
                  className="fold-more"
                  onClick={() => setTxOpen((v) => !v)}
                  aria-expanded={txOpen}
                >
                  {txOpen ? '收起' : `展开全部 ${recent_transactions.length} 条`}
                  <i className="chev" />
                </button>
              )}
            </>
          ) : <div className="prize-empty">暂无流水记录</div>}
        </div>

        {current_balance > 0 && (
          <div className="cta">
            <GoldButton variant="gold" onClick={openWithdraw}>支取奖池</GoldButton>
          </div>
        )}
      </section>
    </>
  )
}
