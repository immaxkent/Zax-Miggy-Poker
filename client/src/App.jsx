import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, Link } from 'react-router-dom';
import { WagmiProvider }   from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';

import { wagmiConfig, SERVER_URL } from './utils/web3Config';
import { useAuth }     from './hooks/useAuth';
import { GameProvider, useGame } from './context/GameContext';
import Lobby      from './pages/Lobby';
import PokerTable from './components/PokerTable';
import GameRoute  from './components/GameRoute';

const queryClient = new QueryClient();

const G  = '#00e676';   // neon green
const P  = '#ff0070';   // hot pink
const BG = '#090d14';   // main bg

// ─── Shared nav bar ────────────────────────────────────────────────────────────
function NavBar({ authed, connected }) {
  const { pathname } = useLocation();

  const links = [
    { label: 'HOME',  to: '/',      active: pathname === '/' },
    { label: 'LOBBY', to: '/lobby', active: pathname === '/lobby' },
    { label: 'TABLE', to: '/lobby', active: pathname.startsWith('/game') },
  ];

  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 32px', height: 60,
      background: 'rgba(9,13,20,0.96)', backdropFilter: 'blur(24px)',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      {/* Logo */}
      <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none' }}>
        <div style={{
          width: 34, height: 34, borderRadius: 8,
          background: `linear-gradient(135deg, ${G} 0%, #00b4d8 100%)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 17, color: '#000', fontWeight: 900, flexShrink: 0,
        }}>♠</div>
        <div>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: 14, letterSpacing: '0.12em', lineHeight: 1.15, textTransform: 'uppercase' }}>
            CRYPTO<span style={{ color: G }}>POKER</span>
          </div>
          <div style={{ color: '#334155', fontSize: 9, letterSpacing: '0.25em', textTransform: 'uppercase', marginTop: 1 }}>
            ON-CHAIN · BASE
          </div>
        </div>
      </Link>

      {/* Nav links */}
      <div style={{ display: 'flex', gap: 36 }}>
        {links.map(({ label, to, active }) => (
          <Link key={label} to={to} style={{
            color: active ? G : '#64748b',
            fontSize: 12, fontWeight: 700, letterSpacing: '0.14em',
            textDecoration: 'none', paddingBottom: 3,
            borderBottom: `2px solid ${active ? G : 'transparent'}`,
            transition: 'color 0.15s, border-color 0.15s',
          }}>
            {label}
          </Link>
        ))}
      </div>

      {/* Right */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: connected ? G : '#ef4444',
            boxShadow: `0 0 6px ${connected ? G : '#ef4444'}`,
          }} />
          <span style={{ color: '#64748b', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em' }}>
            1,284 ONLINE
          </span>
        </div>
        <ConnectButton chainStatus="icon" showBalance={false} />
      </div>
    </nav>
  );
}

// ─── Ticker ────────────────────────────────────────────────────────────────────
const TICKER_ITEMS = [
  '✦ HAND #842,193 — FLOPPED QUADS ON THE RIVER',
  '♦ TOURNEY: MIDNIGHT BOUNTY STARTS IN 02:14:33',
  '♥ PLAYER.ETH SCOOPED 12.4 ETH POT',
  '♠ NEW TABLE OPENED — BASE STREET NLH 0.1/0.25',
  '✦ ZAX_DEGEN WINS WITH POCKET ROCKETS',
  '♣ BLITZ HOURLY REGISTERING NOW — BUY-IN ≡ 0.01',
];

function Ticker() {
  const text = [...TICKER_ITEMS, ...TICKER_ITEMS].join('   ·   ');
  return (
    <div style={{
      background: '#0d1520', borderTop: '1px solid rgba(255,255,255,0.05)',
      borderBottom: '1px solid rgba(255,255,255,0.05)',
      padding: '7px 0', overflow: 'hidden', position: 'relative',
    }}>
      <div className="ticker-track" style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>
        <span style={{ color: '#475569', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', fontFamily: 'Space Mono, monospace' }}>
          {text}
        </span>
        <span style={{ color: '#475569', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', fontFamily: 'Space Mono, monospace' }}>
          {'   ·   ' + text}
        </span>
      </div>
    </div>
  );
}

// ─── Floating Card ─────────────────────────────────────────────────────────────
function FloatingCard({ rank, suit, color, style, floatClass }) {
  return (
    <div className={floatClass} style={{
      width: 90, height: 126, borderRadius: 10,
      background: 'linear-gradient(145deg, #ffffff 0%, #f0f0f0 100%)',
      boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.1)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden',
      ...style,
    }}>
      <div style={{ position: 'absolute', top: 8, left: 10, color, fontSize: 16, fontWeight: 900, fontFamily: 'Georgia, serif', lineHeight: 1 }}>{rank}</div>
      <div style={{ position: 'absolute', top: 22, left: 10, color, fontSize: 10 }}>{suit}</div>
      <div style={{ color, fontSize: 48 }}>{suit}</div>
      <div style={{ position: 'absolute', bottom: 8, right: 10, color, fontSize: 16, fontWeight: 900, fontFamily: 'Georgia, serif', lineHeight: 1, transform: 'rotate(180deg)' }}>{rank}</div>
    </div>
  );
}

// ─── Tournament Card ───────────────────────────────────────────────────────────
function TourneyCard({ badge, badgeColor, tag, name, prize, buyIn, players, maxPlayers, starts, colors, size = 'normal' }) {
  const isLarge = size === 'large';
  return (
    <div style={{
      background: '#0d1520', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16,
      padding: isLarge ? 28 : 22, display: 'flex', flexDirection: 'column', gap: isLarge ? 20 : 16,
      transition: 'border-color 0.2s, transform 0.2s',
      cursor: 'pointer',
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'; e.currentTarget.style.transform = 'none'; }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: badgeColor || G,
          background: `${badgeColor || G}18`, border: `1px solid ${badgeColor || G}40`,
          padding: '3px 8px', borderRadius: 4,
        }}>{badge}</div>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#64748b', letterSpacing: '0.1em' }}>{tag}</div>
      </div>
      <div>
        <div style={{ color: '#fff', fontWeight: 800, fontSize: isLarge ? 22 : 18, letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1.2 }}>{name}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {[
          { label: 'PRIZE POOL', value: `≡ ${prize}` },
          { label: 'BUY-IN', value: `≡ ${buyIn}` },
          { label: 'PLAYERS', value: `${players}/${maxPlayers}` },
          { label: 'STARTS', value: starts },
        ].map(({ label, value }) => (
          <div key={label}>
            <div style={{ color: '#475569', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', marginBottom: 3 }}>{label}</div>
            <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 13 }}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: -6 }}>
          {colors.map((c, i) => (
            <div key={i} style={{ width: 20, height: 20, borderRadius: '50%', background: c, border: '2px solid #0d1520', marginLeft: i === 0 ? 0 : -6 }} />
          ))}
        </div>
        <button style={{
          background: `${G}18`, border: `1px solid ${G}40`, color: G,
          fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', padding: '6px 14px', borderRadius: 6,
          cursor: 'pointer', transition: 'background 0.15s',
        }}>+ REGISTER</button>
      </div>
    </div>
  );
}

// ─── Landing page (shown at / when not authed) ─────────────────────────────────
function LandingPage({ address, authed, loading, authError, login, serverReachable }) {
  const STATS = [
    { label: 'TOTAL WAGERED', value: '≡ 184,392' },
    { label: 'HANDS PLAYED',  value: '12.4M' },
    { label: 'ACTIVE TABLES', value: '247' },
    { label: 'AVG PAYOUT',    value: '1.4S' },
  ];

  const TOURNEYS = [
    { badge: 'STARTING SOON', badgeColor: G,   tag: 'NLH · KNOCKOUT',   name: 'Midnight Bounty', prize: '50.0', buyIn: '0.25', players: 185, maxPlayers: 512, starts: '02:14:33', colors: ['#00e676','#00b4d8','#ff0070','#a855f7','#f59e0b'], size: 'large' },
    { badge: 'REGISTERING',   badgeColor: P,   tag: 'PLO · FREEZEOUT',  name: 'Satoshi Sunday',  prize: '12.5', buyIn: '0.05', players: 94,  maxPlayers: 256, starts: 'SUN 20:00', colors: ['#00b4d8','#a855f7','#f59e0b'] },
    { badge: 'LIVE',          badgeColor: G,   tag: 'TURBO · NLH',      name: 'Blitz Hourly',    prize: '1.8',  buyIn: '0.01', players: 42,  maxPlayers: 128, starts: '00:23:11', colors: ['#ff0070','#f59e0b','#00e676','#a855f7'] },
    { badge: 'REGISTERING',   badgeColor: '#f59e0b', tag: 'HIGH ROLLER', name: 'Whale Room',      prize: '220',  buyIn: '5.00', players: 12,  maxPlayers: 40,  starts: 'FRI 21:00', colors: ['#f59e0b','#00e676'] },
    { badge: 'STARTING SOON', badgeColor: G,   tag: 'NLH · RE-ENTRY',   name: 'Daily Deepstack',  prize: '8.4',  buyIn: '0.10', players: 210, maxPlayers: 400, starts: '04:02:40', colors: ['#a855f7','#00b4d8','#ff0070'] },
  ];

  return (
    <div style={{ minHeight: '100vh', background: BG }}>
      {/* Hero */}
      <section style={{
        position: 'relative', minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', textAlign: 'center',
        padding: '80px 24px 40px', overflow: 'hidden',
      }}>
        {/* Radial glow background */}
        <div style={{
          position: 'absolute', top: '20%', left: '50%', transform: 'translateX(-50%)',
          width: 600, height: 600, borderRadius: '50%',
          background: `radial-gradient(circle, ${G}12 0%, transparent 70%)`,
          pointerEvents: 'none',
        }} />
        {/* Floating cards */}
        <div style={{ position: 'absolute', top: '18%', left: '8%' }}>
          <FloatingCard rank="A" suit="♠" color="#1e293b" floatClass="float-a" />
        </div>
        <div style={{ position: 'absolute', top: '14%', right: '7%' }}>
          <FloatingCard rank="K" suit="♥" color="#ef4444" floatClass="float-b" />
        </div>
        <div style={{ position: 'absolute', top: '55%', left: '4%', opacity: 0.4 }}>
          <FloatingCard rank="A" suit="♣" color="#1e293b" floatClass="float-b" style={{ width: 56, height: 78, borderRadius: 6 }} />
        </div>

        {/* Badge */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 32,
          background: `${G}14`, border: `1px solid ${G}40`, borderRadius: 24,
          padding: '6px 16px', color: G, fontSize: 11, fontWeight: 700, letterSpacing: '0.18em',
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: G, boxShadow: `0 0 6px ${G}` }} />
          NOW LIVE ON BASE MAINNET
        </div>

        {/* Headline */}
        <h1 style={{ fontSize: 'clamp(52px, 10vw, 100px)', fontWeight: 900, letterSpacing: '-0.01em', lineHeight: 0.95, marginBottom: 20, textTransform: 'uppercase' }}>
          <div style={{ color: '#fff' }}>Play Poker.</div>
          <div style={{ color: G, textShadow: `0 0 40px ${G}60` }}>Win Crypto.</div>
        </h1>

        <div style={{ color: '#94a3b8', fontSize: 'clamp(16px, 2vw, 22px)', fontWeight: 600, letterSpacing: '0.2em', marginBottom: 20, textTransform: 'uppercase' }}>
          On-Chain. No House.
        </div>

        <p style={{ color: '#475569', fontSize: 15, maxWidth: 420, marginBottom: 36, lineHeight: 1.6 }}>
          Provably fair Texas Hold'em settled on Base. Your keys. Your chips. Your edge. Zero rake on the first 10,000 hands.
        </p>

        {/* CTAs */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 36, flexWrap: 'wrap', justifyContent: 'center' }}>
          {authed ? (
            <Link to="/lobby" style={{
              padding: '14px 40px', borderRadius: 8, textDecoration: 'none',
              background: `linear-gradient(135deg, ${G}, #00b4d8)`,
              color: '#000', fontSize: 14, fontWeight: 800, letterSpacing: '0.12em',
              boxShadow: `0 0 30px ${G}40`,
            }}>
              ENTER LOBBY →
            </Link>
          ) : !address ? (
            <>
              <ConnectButton />
              <button style={{
                padding: '12px 28px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)',
                background: 'transparent', color: '#94a3b8', fontSize: 13, fontWeight: 700,
                letterSpacing: '0.1em', cursor: 'pointer',
              }}>
                ✉ SIGN IN WITH EMAIL
              </button>
            </>
          ) : (
            <>
              {serverReachable === false && (
                <div style={{
                  color: '#fbbf24', fontSize: 13, padding: '10px 20px', borderRadius: 8,
                  background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
                  maxWidth: 360, textAlign: 'center',
                }}>
                  Game server unreachable. Start it or check your tunnel.
                </div>
              )}
              {authError && (
                <div style={{ color: '#f87171', fontSize: 13, padding: '8px 16px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
                  {authError}
                </div>
              )}
              <button onClick={login} disabled={loading || serverReachable === false}
                style={{
                  padding: '14px 36px', borderRadius: 8, border: 'none',
                  background: `linear-gradient(135deg, ${G}, #00b4d8)`,
                  color: '#000', fontSize: 14, fontWeight: 800, letterSpacing: '0.12em',
                  cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
                  boxShadow: `0 0 30px ${G}40`,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                {loading ? '⏳ SIGNING...' : '🔐 SIGN IN TO PLAY'}
              </button>
              <ConnectButton chainStatus="icon" showBalance={false} />
            </>
          )}
        </div>

        {/* Trust badges */}
        <div style={{ display: 'flex', gap: 24, color: '#475569', fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', flexWrap: 'wrap', justifyContent: 'center' }}>
          {['⊙ AUDITED CONTRACTS', '⊙ TRANSPARENT SHUFFLES', '⊡ SUB-SECOND ACTIONS'].map(b => (
            <span key={b}>{b}</span>
          ))}
        </div>
      </section>

      {/* Stats bar */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        background: '#0d1520', borderTop: '1px solid rgba(255,255,255,0.05)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}>
        {STATS.map(({ label, value }, i) => (
          <div key={label} style={{
            padding: '28px 24px', textAlign: 'center',
            borderRight: i < 3 ? '1px solid rgba(255,255,255,0.05)' : 'none',
          }}>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: 28, fontFamily: 'Space Mono, monospace', marginBottom: 6 }}>{value}</div>
            <div style={{ color: '#334155', fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Ticker */}
      <Ticker />

      {/* Tournaments */}
      <section style={{ maxWidth: 1100, margin: '0 auto', padding: '64px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 32 }}>
          <div>
            <div style={{ color: '#334155', fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', marginBottom: 8 }}>// UPCOMING</div>
            <h2 style={{ color: '#fff', fontWeight: 900, fontSize: 28, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              TOURNAMENTS / <span style={{ color: P }}>LIVE</span>
            </h2>
          </div>
          <a href="/lobby" style={{ color: '#334155', fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', textDecoration: 'none' }}>VIEW ALL →</a>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <TourneyCard {...TOURNEYS[0]} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {TOURNEYS.slice(1, 3).map(t => <TourneyCard key={t.name} {...t} />)}
          </div>
          {TOURNEYS.slice(3).map(t => <TourneyCard key={t.name} {...t} />)}
        </div>
      </section>

      {/* Features */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
        background: '#0d1520', borderTop: '1px solid rgba(255,255,255,0.05)',
      }}>
        {[
          { icon: '🛡', title: 'PROVABLY FAIR', desc: 'Every shuffle commits a hash on-chain. Verify any hand, any time.' },
          { icon: '⚡', title: 'INSTANT SETTLEMENT', desc: 'Wins land in your wallet the moment the hand ends. No cashier.' },
          { icon: '👁', title: 'ZERO CUSTODY', desc: "We never hold your funds. Smart contracts move chips, not us." },
        ].map(({ icon, title, desc }, i) => (
          <div key={title} style={{
            padding: '48px 36px',
            borderRight: i < 2 ? '1px solid rgba(255,255,255,0.05)' : 'none',
          }}>
            <div style={{ fontSize: 28, marginBottom: 16 }}>{icon}</div>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: 13, letterSpacing: '0.18em', marginBottom: 12 }}>{title}</div>
            <div style={{ color: '#475569', fontSize: 14, lineHeight: 1.6 }}>{desc}</div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '20px 32px', borderTop: '1px solid rgba(255,255,255,0.05)',
        color: '#334155', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em',
      }}>
        <span>© 2026 CRYPTOPOKER · CONTRACT 0X7A.F302</span>
        <span>RESPONSIBLE PLAY · 18+ · GAMBLING MAY BE ADDICTIVE.</span>
      </div>
    </div>
  );
}

// ─── Inner app (inside router + providers) ────────────────────────────────────
function AppRoutes() {
  const { token, authed, loading, authError, login, address } = useAuth();
  const { connected, gameState, notification, error: socketError } = useGame();
  const [serverReachable, setServerReachable] = useState(null);
  const [showConnectionHint, setShowConnectionHint] = useState(false);

  useEffect(() => {
    if (connected || socketError) { setShowConnectionHint(false); return; }
    if (!authed) return;
    const t = setTimeout(() => setShowConnectionHint(true), 5000);
    return () => clearTimeout(t);
  }, [connected, socketError, authed]);

  useEffect(() => {
    if (!address || authed) return;
    let cancelled = false;
    setServerReachable(null);
    fetch(`${SERVER_URL}/health`).then(() => {
      if (!cancelled) setServerReachable(true);
    }).catch(() => {
      if (!cancelled) setServerReachable(false);
    });
    return () => { cancelled = true; };
  }, [address, authed]);

  return (
    <div style={{ background: BG, fontFamily: "'Space Grotesk', 'Outfit', sans-serif" }}>
      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translate(-50%, -20px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
        a:hover { opacity: 0.85; }
      `}</style>

      <NavBar authed={authed} connected={connected} socketError={socketError} />

      {/* Global toast */}
      {notification && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl font-bold text-sm"
          style={{
            background: notification.type === 'win'
              ? 'linear-gradient(135deg, #052e16, #14532d)'
              : 'linear-gradient(135deg, #0c1a3a, #1e3a5f)',
            border: `1px solid ${notification.type === 'win' ? G : '#3b82f6'}`,
            boxShadow: `0 8px 32px ${notification.type === 'win' ? `${G}40` : 'rgba(59,130,246,0.3)'}`,
            color: 'white', animation: 'slideDown 0.3s ease',
          }}>
          {notification.message}
        </div>
      )}

      {/* Main — padded for fixed nav, except on game pages which handle their own height */}
      <main style={{ paddingTop: 60 }}>
        <Routes>
          <Route path="/" element={
            <LandingPage
              address={address}
              authed={authed}
              loading={loading}
              authError={authError}
              login={login}
              serverReachable={serverReachable}
            />
          } />

          <Route path="/lobby" element={
            !authed
              ? <Navigate to="/" replace />
              : (gameState && !gameState.tableId?.startsWith('usdc-'))
                ? <PokerTable myAddress={address?.toLowerCase()} />
                : <Lobby token={token} address={address} />
          } />

          <Route path="/game/:gameId" element={
            !authed
              ? <Navigate to="/" replace />
              : <GameRoute />
          } />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {socketError && address && authed && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 50,
          color: '#f87171', fontSize: 13, padding: '10px 16px', borderRadius: 10,
          background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)',
        }}>
          ⚠ {socketError}
        </div>
      )}
    </div>
  );
}

// ─── Provider bridge ──────────────────────────────────────────────────────────
function AuthenticatedGameProvider({ children }) {
  const { token, address } = useAuth();
  return (
    <GameProvider authToken={token} walletAddress={address?.toLowerCase()}>
      {children}
    </GameProvider>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <BrowserRouter>
            <AuthenticatedGameProvider>
              <AppRoutes />
            </AuthenticatedGameProvider>
          </BrowserRouter>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
