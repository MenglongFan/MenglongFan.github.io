import { useState, useEffect, useRef } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useAuthGate } from '../lib/authGate'
import Avatar from '../components/Avatar'
import PageHead from '../components/PageHead'
import GoldButton from '../components/GoldButton'
import CountUp from '../components/CountUp'

// 捐赠记录一页多少条。后端 limit 上限是 200，这里取小一点，
// 让「加载更多」真的会出现在只有几十笔的场景里，而不是永远够用、永远测不到。
const DONATION_PAGE = 50

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

/**
 * 录入一笔慈善捐赠。
 *
 * 选人复用「赛季 → 选参赛者」那套 .player-pick（头像 + 勾），不用 <select>：
 * 这个 app 里没有下拉框，原生 select 在暗色玻璃面板上会长成系统控件的样子，
 * 一眼就是「外来的」。而且头像能直接确认是谁，选错人比选错金额更常见。
 * 单选：再点一次取消。
 */
function DonateForm({ submitRef, players }) {
  const [playerId, setPlayerId] = useState(null)
  const [amount, setAmount] = useState('')
  const [desc, setDesc] = useState('')
  submitRef.current = () => ({
    player_id: playerId,
    amount: parseFloat(amount),
    description: desc.trim(),
  })
  return (
    <>
      <div className="withdraw-hint">捐赠自愿。金额计入奖池总额，并单独记入捐献列表。</div>
      <label className="form-label">捐赠人</label>
      <div className="player-pick-list">
        {players.map((p) => {
          const isSel = playerId === p.id
          const pick = () => setPlayerId(isSel ? null : p.id)
          return (
            <div key={p.id} className={`player-pick ${isSel ? 'selected' : ''}`} onClick={pick}>
              <Avatar url={p.avatar_url} name={p.name} className="pick-avatar" />
              <div className="check">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>
              </div>
              <label onClick={(e) => { e.preventDefault(); pick() }}>{p.name}</label>
            </div>
          )
        })}
      </div>
      <div className="form-group" style={{ marginTop: 16 }}>
        <label className="form-label">捐赠金额（元）</label>
        <input className="form-input" type="number" min="0.01" step="0.01" value={amount} placeholder="输入金额" onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">备注（选填）</label>
        <input className="form-input" value={desc} placeholder="如：本次聚会结余" onChange={(e) => setDesc(e.target.value)} />
      </div>
    </>
  )
}

// 时间点：created_at 形如 "2026-09-21 05:18:29" → "09-21 05:18"（和逐局战绩同一套写法）
function fmtWhen(s) {
  return s ? s.slice(5, 16).replace('T', ' ') : '—'
}

// 没填备注时后端落库的是固定默认串 '慈善捐赠'。那是个占位符、不是用户写的话，
// 别把它当备注再显示一遍。账单说明和捐赠记录两处都要这个判断 ——
// 判据写两遍，迟早只改一处。
// 返回**裸**备注：分隔符由调用方自己加，两处的前后文不同。
function donationNote(desc) {
  return desc && desc !== '慈善捐赠' ? desc : ''
}

// 三种类型都要有分支。原来写的是「不是 fine 就是支取」——
// 加了 donation 之后，一笔**入账**会被标成「支取」，一个账本把入账标成出账是致命的。
function txLabel(t) {
  if (t.type === 'fine') return '罚金入账'
  if (t.type === 'donation') return '慈善捐赠'
  return '支取'
}

function txDesc(t) {
  if (t.type === 'fine') return (t.season_name || '赛季罚金') + ' · ' + (t.player_name || '')
  if (t.type === 'donation') {
    const who = t.player_name || ''
    const note = donationNote(t.description)
    return note ? `${who} · ${note}` : who
  }
  return t.description || '支取'
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
  const { showToast, setModalContent, closeModal, confirmAction } = useAuth()
  const ensureAuth = useAuthGate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  // 账单：open 控制挂载，closing 只用来播收起的动画（播完才卸载）
  const [billOpen, setBillOpen] = useState(false)
  const [billClosing, setBillClosing] = useState(false)
  const [billData, setBillData] = useState(null)
  const billTimer = useRef(null)
  const withdrawRef = useRef(null)
  const donateRef = useRef(null)
  // 已经拉下来的捐赠记录。翻页是**累加**的：弹窗内容每次都要收到全量，
  // 只塞新一页的话，先前那些行会凭空消失。
  const donationRef = useRef({ items: [], total: 0 })

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

  // ---------- 慈善捐赠：录入 / 逐笔列表 / 删除 ----------
  //
  // 三个动作都要房主密码 —— 捐赠是账务操作，开放录入等于任何人可以伪造一笔入账
  // 并给自己发称谓。CONTEXT.md 里房主密码保护的正是「成绩录入、花名册管理、
  // 赛季管理、奖池支取」这一类。
  const openDonate = () => {
    ensureAuth('录入慈善捐赠', async () => {
      try {
        const players = await api('/api/players')
        setModalContent('录入慈善捐赠',
          <DonateForm submitRef={donateRef} players={players} />,
          <>
            <button className="btn btn-ghost" onClick={() => { closeModal(); load() }}>返回</button>
            <button className="btn btn-primary" onClick={async () => {
              const v = donateRef.current ? donateRef.current() : {}
              if (!v.player_id) { showToast('请选择捐赠人', 'error'); return }
              if (!v.amount || v.amount <= 0) { showToast('请输入有效金额', 'error'); return }
              try {
                const res = await api('/api/prize-pool/donate', { method: 'POST', auth: true, body: JSON.stringify(v) })
                showToast(res.title ? `已记录 · 累计 ${res.player_total} 元 · ${res.title}` : '已记录', 'success')
                closeModal()
                await load()
              } catch (e) { showToast(e.message, 'error') }
            }}>确认录入</button>
          </>)
      } catch (e) {
        showToast(e.message, 'error')
      }
    })
  }

  // 弹窗必须在**拿到数据之后**才 setModalContent。
  // setModalContent 存的是已经创建好的元素，传进去那一刻捕获的数组就定死了；
  // 先建弹窗再往里塞数据的话，删掉一条之后列表不会变 —— 这个坑赛季管理里踩过一次。
  // 所以每翻一页都整份重渲染，items 传的是**累加后的全量**。
  const renderDonationList = (items, total) => {
    const hasMore = items.length < total
    setModalContent(
      `慈善捐赠记录 · ${total} 笔`,
      items.length === 0
        ? <div className="prize-empty">暂无捐赠记录</div>
        : (
          <div className="donation-list">
            {items.map((d) => {
              const note = donationNote(d.description)
              return (
                <div className="donation-item" key={d.id}>
                  <div className="donation-line1">
                    <Avatar url={d.avatar_url} name={d.player_name} className="contrib-avatar" />
                    <span className="contrib-name">{d.player_name || '—'}</span>
                    <span className="donation-amount">+{d.amount}元</span>
                  </div>
                  {/* 删除放在第二行右端，不和金额抢同一行 —— 金额是这条记录的重点，
                      把删除按钮悬在它旁边，窄屏上一定会压到数字。 */}
                  <div className="donation-meta">
                    {/* donationNote 返回的是**裸**备注（没带分隔符），分隔符由调用方给 ——
                        账单那边是「人 · 备注」，这边是「时间 · 余额 · 备注」，两边不一样。
                        抽掉的只是「默认串不算备注」这个判据，那才是必须两处一致的东西。 */}
                    <span>{fmtWhen(d.created_at)} · 余额 {d.balance}元{note && ` · ${note}`}</span>
                    <button className="donation-del" onClick={() => removeDonation(d)}>删除</button>
                  </div>
                </div>
              )
            })}
          </div>
        ),
      <>
        {hasMore && (
          <button className="btn btn-ghost" onClick={loadMoreDonations}>
            加载更多（还有 {total - items.length} 笔）
          </button>
        )}
        <button className="btn btn-ghost" onClick={() => { closeModal(); load() }}>关闭</button>
      </>
    )
  }

  const fetchDonations = async (offset) => {
    const res = await api(`/api/prize-pool/donations?limit=${DONATION_PAGE}&offset=${offset}`)
    return { items: res.donations || [], total: res.total ?? 0 }
  }

  const showDonations = (items, total) => {
    donationRef.current = { items, total }
    renderDonationList(items, total)
  }

  // 读操作公开：逐笔捐赠记录和奖池流水一样，谁都能看。写操作才要房主密码。
  // 之前这里整个套了 ensureAuth，跟同一页的账单（openBill 直接 api）不一致，
  // 也和规格「读公开、写需密码」相悖 —— 游客能看到汇总却看不到明细，没有道理。
  const openDonationList = async () => {
    try {
      const { items, total } = await fetchDonations(0)
      showDonations(items, total)
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const loadMoreDonations = async () => {
    const loaded = donationRef.current.items
    try {
      const { items, total } = await fetchDonations(loaded.length)
      showDonations([...loaded, ...items], total)
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  // 删除是写操作，单独走鉴权。列表本身公开之后，这一层不能省 ——
  // 否则游客看到一排「删除」，点下去只会得到一个 401。
  const removeDonation = (d) => {
    ensureAuth('删除慈善捐赠', () =>
      confirmAction(
        `确定删除 ${d.player_name || '这笔'} 的 ${d.amount} 元捐赠？删除后奖池余额会重新计算，该玩家的累计捐赠额与称谓也会跟着变。`,
        async () => {
          try {
            await api(`/api/prize-pool/donation/${d.id}`, { method: 'DELETE', auth: true })
            showToast('已删除', 'success')
            // 删完从第一页重新拉。删除是管理动作不是浏览动作，
            // 规格要的是「列表立刻反映结果」，不是「保持在第 N 页」。
            const { items, total } = await fetchDonations(0)
            showDonations(items, total)
            await load()
          } catch (e) {
            showToast(e.message, 'error')
          }
        }
      )
    )
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
        <PageHead eyebrow="奖池" meta="读取中" title="奖池明细" sub="正在同步奖池余额" />
        <div className="standings-empty"><div className="big">加载中...</div></div>
      </>
    )
  }

  if (!data) {
    return (
      <>
        <PageHead eyebrow="奖池" meta="读取失败" title="奖池明细" sub="稍后重试" muted />
        <div className="standings-empty">
          <div className="seal">赏</div>
          <div className="big">奖池</div>
          <div>加载失败</div>
        </div>
      </>
    )
  }

  const { current_balance, contributions, recent_transactions } = data
  // 老响应没有这两个字段时给默认值，别让页面因为后端没跟上就白屏
  const donors = data.donors || []
  const donationTotal = data.donation_total || 0

  return (
    <>
      <PageHead
        eyebrow="奖池"
        meta={`${contributions.length} 人 · ${recent_transactions.length} 笔`}
        title="奖池明细"
        sub="末尾三名罚金 + 自愿捐赠 · 跨赛季滚存"
      />

      <section className="standings">
        {/* 余额这块既是「现在多少钱」，也是打开流水的入口：双击弹账单。
            为什么不做成按钮：下面已经有「支取奖池」了，再摞一个按钮又丑又抢眼；
            而余额是这一页唯一的主角，双击它最自然。
            代价是双击不可见，所以下面挂一行小字提示，另外给键盘留 Enter/Space。
            两个细节：user-select:none 否则双击会顺手选中「30元」并高亮；
            touch-action:manipulation 否则手机上双击会触发缩放、dblclick 不派发。 */}
        <div
          className="prize-total"
          role="button"
          tabIndex={0}
          aria-label={`公共基金池 ${current_balance} 元，双击查看流水`}
          onDoubleClick={openBill}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBill() }
          }}
        >
          <div className="label">公共基金池</div>
          <div className="amount">
            <CountUp to={current_balance || 0} from={0} duration={1.2} />
            <span className="yuan">元</span>
          </div>
          {/* 「总金额体现在奖池中」的落点：余额是罚金 + 捐赠的合计。
              不给这一行拆分，房主就分不清这 30 元里有多少是捐的 —— 而捐赠是
              「谁掏过钱」的唯一凭据，混在总数里等于白捐。为 0 时不占位置。 */}
          {donationTotal > 0 && (
            <div className="prize-split">其中慈善捐赠 {donationTotal} 元</div>
          )}
          <div className="prize-hint">双击查看流水</div>
        </div>

        {/* 两块榜并排（宽屏）。为什么不是竖着摞：加了慈善捐赠之后，
            1440×900 下页面被顶出视口 155px，而这一页的既有约束是「不出现滚动条」。
            并排之后高度取两者较高的那条，正好省下一整块榜的高度。
            窄屏不并排 —— 390 宽下每栏只剩 175px，人名会被称谓胶囊挤没。 */}
        <div className="prize-boards">
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

        {/* 慈善捐赠：和贡献榜并列，但**是另一张榜**。
            罚金是「输了交钱」、捐赠是「自愿掏钱」，语义相反 —— 排进同一个名次序列
            等于把「被罚最多」和「最慷慨」当成同一件事。
            用词跟 CONTEXT.md 的词条走（慈善捐赠 / 捐赠称谓）：叫「慈善奖金」会把这笔钱
            说成一份奖金，而 ADR 0010 的全部理由正是「捐赠不是奖金、只是进同一个池子」。
            称谓由后端按终身累计额派生（阈值只在 worker 里存一份），前端不重复一遍：
            两份阈值迟早会改歪，而且改的那天一定只改一边。 */}
        <div className="prize-section">
          <div className="prize-section-title">
            <span>慈善捐赠</span>
            <span className="count">{donationTotal} 元 · {donors.length} 人</span>
          </div>
          {donors.length > 0 ? (
            <div className="contribution-list">
              {donors.map((d) => (
                <div className="contribution-item" key={d.id}>
                  <Avatar url={d.avatar_url} name={d.name} className="contrib-avatar" />
                  <span className="contrib-name">{d.name}</span>
                  {d.title && <span className="donor-title">{d.title}</span>}
                  <span className="contrib-amount">{d.total_amount}元</span>
                </div>
              ))}
            </div>
          ) : <div className="prize-empty">还没有人捐赠</div>}

          {/* 主操作（录入）用实心、次操作（查记录）用灰边，一行只有一个视觉重点。
              不做成通栏：整页的通栏主行动是底下的「支取奖池」，再摞一条就分不出主次了。 */}
          <div className="donate-actions">
            <button className="btn btn-primary" onClick={openDonate}>录入捐赠</button>
            {donors.length > 0 && (
              <button className="btn btn-ghost" onClick={openDonationList}>捐赠记录</button>
            )}
          </div>
        </div>
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
