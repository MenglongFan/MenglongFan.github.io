import React, { useState, useEffect } from 'react'
import { Routes, Route, useLocation, Link } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import { api } from './lib/api'

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

// ============ Season Badge ============
function SeasonBadge() {
  const [season, setSeason] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await api('/api/standings')
        if (!cancelled) {
          setSeason(data.season)
          setLoading(false)
        }
      } catch {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className="season-badge">
        <span className="dot" />
        加载中...
      </div>
    )
  }

  if (!season) {
    return (
      <div className="season-badge inactive">
        <span className="dot" />
        暂无活跃赛季
      </div>
    )
  }

  return (
    <div className={season.is_active ? 'season-badge' : 'season-badge inactive'}>
      <span className="dot" />
      {season.name}{season.is_active ? '' : ' · 已结束'}
    </div>
  )
}

// ============ App Layout ============
function AppLayout() {
  return (
    <>
      {/* 背景效果 */}
      <div className="ink-bloom tl" />
      <div className="ink-bloom br" />
      <div className="ink-bloom mid" />
      <div className="noise" />
      <svg className="mountains" viewBox="0 0 1200 120" preserveAspectRatio="none">
        <path d="M0,120 L0,80 L100,50 L180,70 L260,30 L340,60 L420,20 L500,55 L580,35 L660,65 L740,25 L820,50 L900,40 L980,70 L1060,45 L1140,60 L1200,35 L1200,120 Z" fill="var(--paper)" />
        <path d="M0,120 L0,100 L80,75 L160,90 L240,65 L320,85 L400,70 L480,95 L560,80 L640,100 L720,85 L800,95 L880,75 L960,90 L1040,80 L1120,95 L1200,85 L1200,120 Z" fill="var(--paper)" opacity="0.5" />
      </svg>

      {/* 主容器 */}
      <div className="app">
        {/* 页头 */}
        <div className="header">
          <div className="header-ornament">
            <span className="line" />
            <span className="diamond" />
            <span className="line r" />
          </div>
          <div className="header-title">国战积分</div>
          <div className="header-sub">三国杀国战积分系统</div>
          <SeasonBadge />
        </div>

        {/* 页面路由 */}
        <div className="page-content">
          <Routes>
            <Route path="/" element={<StandingsPage />} />
            <Route path="/match" element={<MatchPage />} />
            <Route path="/season" element={<SeasonPage />} />
            <Route path="/prize" element={<PrizePage />} />
            <Route path="/roster" element={<RosterPage />} />
          </Routes>
        </div>

        {/* 页脚 */}
        <div className="footer">心诚则灵 · 战绩为凭</div>
      </div>

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
