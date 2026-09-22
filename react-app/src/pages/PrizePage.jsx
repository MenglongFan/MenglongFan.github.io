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

// 时间点：created_at 形如 "2026-09-21 05:18:29" → "09-21 05:18"（和逐局战绩同一套写法）
function fmtWhen(s) {
  return s ? s.slice(5, 16).replace('T', ' ') : '—'
}

function txLabel(t) {
  return t.type === 'fine' ? '罚金入账' : '支取'
}

function txDesc(t) {
  return t.type === 'fine'
    ? (t.season_name || '赛季罚金') + ' · ' + (t.player_name || '')
    : (t.description || '支取')
}

/**
 * 账单：从屏幕顶部落下的一块流水面板。
 *
 * 为什么单独做一个而不是继续用「展开全部」：流水只增不减，内滚列表越用越长，
 * 而「一共多少钱、什么时候进的、余额怎么变的」是账本问题，需要一眼看全。
 * 做成从顶边落下的整块面板，关掉就回到奖池页，不占页面高度。
 *
 * 动画方向是**从上方落下来**（translateY(-102%) → 0），不是常见的从下往上弹 ——
 * 账单是「挂下来」的，所以面板贴着屏幕顶边、只留下方圆角，顶部加一道金线当横杆。
 */
function Bill({ open, closing, items, total, balance, loading, onClose }) {
  if (!open) return null
  return (
    <div
      className={`bill-overlay${closing ? ' closing' : ''}`}
      onClick={onClose}
    >
      <div
        className="bill"
        role="dialog"
        aria-label="奖池流水"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bill-hd">
          <div className="bill-seal">账</div>
          <div className="bill-hd-main">
            <div className="bill-title">奖池流水</div>
            <div className="bill-sub">
              {loading ? '读取中…' : `共 ${total} 笔 · 当前余额 ${balance} 元`}
            </div>
          </div>
          <button className="bill-close" onClick={onClose} aria-label="关闭">&times;</button>
        </div>

        <div className="bill-body">
          {loading && <div className="prize-empty">加载中...</div>}
          {!loading && items.length === 0 && <div className="prize-empty">暂无流水记录</div>}
          {!loading && items.map((t) => {
            const isPositive = t.amount > 0
            return (
              <div className="bill-item" key={t.id}>
                <div className="bill-when">
                  <span className="bill-date">{fmtWhen(t.created_at).slice(0, 5)}</span>
                  <span className="bill-time">{fmtWhen(t.created_at).slice(6)}</span>
                </div>
                <div className="bill-main">
                  <div className="bill-line1">
                    <span className={`tx-type ${t.type}`}>{txLabel(t)}</span>
                    <span className="bill-desc">{txDesc(t)}</span>
                  </div>
                  <div className="bill-line2">余额 {t.balance}元</div>
                </div>
                <div className="bill-amount">
                  <span className={`val ${isPositive ? 'positive' : 'negative'}`}>
                    {isPositive ? '+' : ''}{t.amount}元
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default function PrizePage() {
  const { showToast, setModalContent, closeModal } = useAuth()
  const ensureAuth = useAuthGate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  // 账单：open 控制挂载，closing 只用来播收起的动画（播完才卸载）
  const [billOpen, setBillOpen] = useState(false)
  const [billClosing, setBillClosing] = useState(false)
  const [billData, setBillData] = useState(null)
  const billTimer = useRef(null)
  const withdrawRef = useRef(null)

  useEffect(() => () => { if (billTimer.current) clearTimeout(billTimer.current) }, [])

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

  // 账单：先拿 summary 里已有的最近流水把面板铺满（点下去立刻有内容），再去取全量
  const openBill = async () => {
    if (billTimer.current) { clearTimeout(billTimer.current); billTimer.current = null }
    const seed = (data && data.recent_transactions) || []
    setBillClosing(false)
    setBillData({ items: seed, total: seed.length, loading: true })
    setBillOpen(true)
    try {
      const res = await api('/api/prize-pool/transactions?limit=100')
      const items = res.transactions || []
      setBillData({ items, total: res.total ?? items.length, loading: false })
    } catch (e) {
      setBillData((prev) => ({ ...(prev || { items: [], total: 0 }), loading: false }))
      showToast(e.message, 'error')
    }
  }

  // 收起：先播动画，播完再卸载（直接卸载就没有「收回去」的过程了）
  const closeBill = () => {
    if (billTimer.current) clearTimeout(billTimer.current)
    setBillClosing(true)
    billTimer.current = setTimeout(() => {
      setBillOpen(false)
      setBillClosing(false)
      billTimer.current = null
    }, 380)
  }

  useEffect(() => {
    if (!billOpen) return
    const onKey = (e) => { if (e.key === 'Escape') closeBill() }
    window.addEventListener('keydown', onKey)
    // 锁滚动要连 <html> 一起锁：真正的滚动容器是 documentElement，
    // 只锁 body 的话页面滚动条还在，fixed 的遮罩宽度会少掉那 15px，右边缘露出一条亮的。
    const root = document.documentElement
    const prevBody = document.body.style.overflow
    const prevRoot = root.style.overflow
    document.body.style.overflow = 'hidden'
    root.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevBody
      root.style.overflow = prevRoot
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billOpen])

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

  // 页面上只留最近 3 笔当预览（带时间点），完整的走「查看流水」那张账单
  const TX_PREVIEW = 3
  const txVisible = recent_transactions.slice(0, TX_PREVIEW)

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
          <div className="prize-section-title">
            <span>流水</span>
            <span className="count">
              {recent_transactions.length > TX_PREVIEW
                ? `最近 ${TX_PREVIEW} / 共 ${recent_transactions.length} 笔`
                : `共 ${recent_transactions.length} 笔`}
            </span>
          </div>
          {recent_transactions.length > 0 ? (
            <>
              <div className="tx-list">
                {txVisible.map((t) => {
                  const isPositive = t.amount > 0
                  return (
                    <div className="tx-item" key={t.id}>
                      <div className="tx-info">
                        <span className={`tx-type ${t.type}`}>{txLabel(t)}</span>
                        <div className="tx-desc">{txDesc(t)}</div>
                        <div className="tx-when">{fmtWhen(t.created_at)}</div>
                      </div>
                      <div className="tx-amount">
                        <span className={`val ${isPositive ? 'positive' : 'negative'}`}>{isPositive ? '+' : ''}{t.amount}元</span>
                        <span className="balance">余额 {t.balance}元</span>
                      </div>
                    </div>
                  )
                })}
              </div>
              <button type="button" className="bill-open" onClick={openBill}>
                查看流水
                <i className="chev" />
              </button>
            </>
          ) : <div className="prize-empty">暂无流水记录</div>}
        </div>

        {current_balance > 0 && (
          <div className="cta">
            <GoldButton variant="gold" onClick={openWithdraw}>支取奖池</GoldButton>
          </div>
        )}
      </section>

      <Bill
        open={billOpen}
        closing={billClosing}
        items={(billData && billData.items) || []}
        total={(billData && billData.total) || 0}
        balance={current_balance}
        loading={!billData || billData.loading}
        onClose={closeBill}
      />
    </>
  )
}
