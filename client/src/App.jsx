import { useState, useEffect } from 'react';
import { WagmiProvider }   from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';

import { wagmiConfig, SERVER_URL } from './utils/web3Config';
import { useAuth }     from './hooks/useAuth';
import { GameProvider, useGame } from './context/GameContext';
import Lobby      from './pages/Lobby';
import PokerTable from './components/PokerTable';

const queryClient = new QueryClient();

// ─── Inner app (wallet + auth available) ─────────────────────────────────────
function GameApp() {
  const { token, authed, loading, authError, login, address } = useAuth();
  const { connected, gameState, notification, error: socketError } = useGame();
  const [serverReachable, setServerReachable] = useState(null);
  const [showConnectionHint, setShowConnectionHint] = useState(false);

  // Only show the long "check tunnel" hint after we've been connecting for a few seconds
  useEffect(() => {
    if (connected || socketError) {
      setShowConnectionHint(false);
      return;
    }
    if (!authed) return;
    const t = setTimeout(() => setShowConnectionHint(true), 5000);
    return () => clearTimeout(t);
  }, [connected, socketError, authed]);

  const isAtTable = !!gameState;

  // Check if game server is running when on sign-in screen
  useEffect(() => {
    if (!address || authed) return;
    let cancelled = false;
    setServerReachable(null);
    fetch(`${SERVER_URL}/health`, { method: 'GET' })
      .then(() => { if (!cancelled) setServerReachable(true); })
      .catch(() => { if (!cancelled) setServerReachable(false); });
    return () => { cancelled = true; };
  }, [address, authed]);

  return (
    <div className="min-h-screen" style={{ background: '#060d1a', fontFamily: "'Outfit', sans-serif" }}>
      {/* Global font */}
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700;900&display=swap');`}</style>

      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(12px)' }}>

        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="text-2xl">♠</div>
          <div>
            <div className="text-white font-bold text-lg leading-none tracking-wide">CRYPTO<span style={{ color: '#f59e0b' }}>POKER</span></div>
            <div className="text-gray-600 text-xs">on Base</div>
          </div>
        </div>

        {/* Connection status */}
        <div className="flex items-center gap-3">
          {authed && (
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs"
                style={{ background: connected ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                  border: `1px solid ${connected ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                  color: connected ? '#4ade80' : '#f87171' }}>
                <div className="w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ background: connected ? '#4ade80' : '#f87171' }} />
                {connected ? 'Server connected' : (socketError ? `Failed: ${socketError}` : 'Connecting...')}
              </div>
              {!connected && !socketError && (() => {
                const isLocalDev = typeof window !== 'undefined' && window.location?.hostname === 'localhost' && window.location?.port === '5173';
                return isLocalDev ? (
                  <span className="text-gray-500 text-xs">Start the game server: <code className="text-gray-400">cd server && npm run dev</code> (port 3001). This app is on 5173.</span>
                ) : showConnectionHint ? (
                  <span className="text-gray-500 text-xs">Still connecting — check that the server and tunnel (e.g. ngrok) are running on EC2.</span>
                ) : null;
              })()}
            </div>
          )}
          <ConnectButton chainStatus="icon" showBalance={false} />
        </div>
      </nav>

      {/* Notification toast */}
      {notification && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl font-bold text-sm"
          style={{ background: notification.type === 'win'
            ? 'linear-gradient(135deg, #14532d, #166534)'
            : 'linear-gradient(135deg, #1e3a5f, #1e40af)',
            border: `1px solid ${notification.type === 'win' ? '#22c55e' : '#3b82f6'}`,
            boxShadow: `0 8px 32px ${notification.type === 'win' ? 'rgba(34,197,94,0.3)' : 'rgba(59,130,246,0.3)'}`,
            color: 'white', animation: 'slideDown 0.3s ease' }}>
          {notification.message}
        </div>
      )}

      {/* Main content */}
      <main className="py-8">
        {!address ? (
          // Not connected
          <div className="flex flex-col items-center justify-center gap-6 py-24">
            <div className="text-8xl mb-4" style={{ filter: 'drop-shadow(0 0 30px rgba(251,191,36,0.4))' }}>🃏</div>
            <h1 className="text-white font-bold text-4xl text-center">
              Play Poker.<br />
              <span style={{ color: '#f59e0b' }}>Win Crypto.</span>
            </h1>
            <p className="text-gray-400 text-center max-w-md">
              Connect your wallet to join the table. Powered by Base network.
              Provably fair, fully transparent.
            </p>
            <div className="mt-2"><ConnectButton /></div>
          </div>

        ) : !authed ? (
          // Connected but not authenticated
          <div className="flex flex-col items-center justify-center gap-5 py-24">
            <div className="text-white font-bold text-2xl">Sign in to play</div>
            <p className="text-gray-400 text-sm text-center max-w-xs">
              Sign a message with your wallet to authenticate.<br />
              No gas required — it's free.
            </p>
            {serverReachable === false && (
              <div className="text-amber-200 text-sm px-5 py-3 rounded-xl text-center max-w-md"
                style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)' }}>
                {(() => {
                  const isLocalDev = typeof window !== 'undefined' && window.location?.hostname === 'localhost' && window.location?.port === '5173';
                  return isLocalDev ? (
                    <>
                      <strong>Game server not running.</strong> In another terminal run:<br />
                      <code className="text-white mt-1 inline-block">cd server && npm start</code><br />
                      <span className="text-gray-400 text-xs mt-1 block">Then refresh or click Sign In again.</span>
                    </>
                  ) : (
                    <>
                      <strong>Game server unreachable.</strong> The server or tunnel (e.g. ngrok) may be down. Try again in a moment or check your deployment.
                    </>
                  );
                })()}
              </div>
            )}
            {authError && (
              <div className="text-red-400 text-sm px-4 py-2 rounded-lg"
                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
                {authError}
              </div>
            )}
            <button onClick={login} disabled={loading || serverReachable === false}
              className="px-8 py-3.5 rounded-xl font-bold text-base transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #b45309, #d97706)',
                color: '#fff8e7', boxShadow: '0 4px 20px rgba(245,158,11,0.3)' }}>
              {loading ? '⏳ Signing...' : '🔐 Sign In'}
            </button>
          </div>

        ) : isAtTable ? (
          // At a table — show the poker game
          <PokerTable myAddress={address?.toLowerCase()} />

        ) : (
          // Lobby
          <Lobby token={token} address={address} />
        )}

        {socketError && address && authed && (
          <div className="fixed bottom-6 right-6 text-red-400 text-sm px-4 py-2 rounded-xl z-50"
            style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)' }}>
            ⚠️ {socketError}
          </div>
        )}
      </main>

      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translate(-50%, -20px); }
          to   { opacity: 1; transform: translate(-50%, 0);     }
        }
      `}</style>
    </div>
  );
}

// ─── Root with providers ──────────────────────────────────────────────────────
function AuthenticatedGameProvider({ children }) {
  const { token, address } = useAuth();
  return (
    <GameProvider authToken={token} walletAddress={address?.toLowerCase()}>
      {children}
    </GameProvider>
  );
}

export default function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <AuthenticatedGameProvider>
            <GameApp />
          </AuthenticatedGameProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
