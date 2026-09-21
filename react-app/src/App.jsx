import { Routes, Route, useLocation, Link } from 'react-router-dom'
import { AuthProvider } from './lib/auth'

import Backdrop from './components/Backdrop'
import ClickSpark from './bits/ClickSpark/ClickSpark'

import StandingsPage from './pages/StandingsPage'
import MatchPage from './pages/MatchPage'
import SeasonPage from './pages/SeasonPage'
import PrizePage from './pages/PrizePage'
import RosterPage from './pages/RosterPage'

// ============ Icons ============
const IconStandings = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 21h8M12 17v4M5 4h14v5a7 7 0 0 1-14 0V4z" />
    <path d="M5 6H2v2a3 3 0 0 0 3 3M19 6h3v2a3 3 0 0 1-3 3" />
  </svg>
)

const IconMatch = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
)

const IconSeason = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
)

const IconPrize = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v10M9 10h4.5a1.5 1.5 0 0 1 0 3H9" />
    <path d="M9 14h5" />
  </svg>
)

const IconRoster = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="7" r="4" />
    <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    <path d="M21 21v-2a4 4 0 0 0-3-3.87" />
  </svg>
)

// ============ Navigation Items ============
const NAV_ITEMS = [
  { path: '/', label: '积分榜', icon: IconStandings },
  { path: '/match', label: '录入', icon: IconMatch },
  { path: '/season', label: '赛季', icon: IconSeason },
  { path: '/prize', label: '奖池', icon: IconPrize },
  { path: '/roster', label: '花名册', icon: IconRoster },
]

// ============ Bottom Navigation ============
function BottomNav() {
  const location = useLocation()
  return (
    <nav className="bottom-nav">
      <div className="bottom-nav-list">
        {NAV_ITEMS.map((item) => {
          const isActive = location.pathname === item.path
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`bottom-nav-item ${isActive ? 'active' : ''}`}
            >
              <item.icon />
              <span className="nav-label">{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

// ============ App Layout ============
function AppLayout() {
  return (
    <>
      {/* 背景三层：WebGL 流体 + 颗粒 + 渐晕 */}
      <Backdrop />

      {/* 点击溅射。canvas 是 pointer-events:none，不会挡住交互 */}
      <ClickSpark
        sparkColor="#E9C87C"
        sparkSize={11}
        sparkRadius={19}
        sparkCount={9}
        duration={520}
      >
        <div className="app">
          {/* 页头由各页自带 —— 五个 tab 的标题/副标题都不一样 */}
          <div className="page-content">
            <Routes>
              <Route path="/" element={<StandingsPage />} />
              <Route path="/match" element={<MatchPage />} />
              <Route path="/season" element={<SeasonPage />} />
              <Route path="/prize" element={<PrizePage />} />
              <Route path="/roster" element={<RosterPage />} />
            </Routes>
          </div>

          <div className="footer">比赛第一 · 友谊长存</div>
        </div>
      </ClickSpark>

      {/* 底部导航栏 */}
      <BottomNav />
    </>
  )
}

// ============ App Root ============
export default function App() {
  return (
    <AuthProvider>
      <AppLayout />
    </AuthProvider>
  )
}
