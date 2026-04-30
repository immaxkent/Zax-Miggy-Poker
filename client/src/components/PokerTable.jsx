import { useState, useEffect, useRef } from 'react';
import { useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { useGame } from '../context/GameContext';
import { ZAX_MIGGY_VAULT_ADDRESS, ZAX_MIGGY_VAULT_ABI, USDC_DECIMALS } from '../utils/web3Config';
import { gameIdToName } from '../pages/Lobby';

const G  = '#00e676';
const P  = '#ff0070';

const SUIT_COLORS   = { s: '#1e293b', h: '#ef4444', d: '#ef4444', c: '#1e293b' };
const SUIT_SYMBOLS  = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RANK_DISPLAY  = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };

// ─── Card ──────────────────────────────────────────────────────────────────────
function Card({ card, hidden, small, large }) {
  if (!card && !hidden) return null;

  const w = large ? 72 : small ? 36 : 56;
  const h = large ? 100 : small ? 52 : 80;
  const fs = large ? 36 : small ? 20 : 28;
  const rankFs = large ? 16 : small ? 9 : 12;

  if (hidden || !card) {
    return (
      <div style={{
        width: w, height: h, borderRadius: small ? 5 : 8,
        background: 'linear-gradient(145deg, #1a0a30 0%, #2d0a50 50%, #1a0a30 100%)',
        border: `1px solid ${P}60`,
        boxShadow: `0 4px 12px rgba(0,0,0,0.5), 0 0 8px ${P}20`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <div style={{
          width: '80%', height: '80%', border: `1px solid ${P}40`, borderRadius: 4,
          backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 3px, ${P}15 3px, ${P}15 4px)`,
        }} />
      </div>
    );
  }

  const color = SUIT_COLORS[card.suit];
  const rank  = RANK_DISPLAY[card.rank] || card.rank;

  return (
    <div style={{
      width: w, height: h, borderRadius: small ? 5 : 8,
      background: 'linear-gradient(145deg, #ffffff 0%, #f4f4f4 100%)',
      border: '1px solid #ddd',
      boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
      color, position: 'relative', overflow: 'hidden', flexShrink: 0,
    }}>
      <div style={{ position: 'absolute', top: small ? 2 : 4, left: small ? 3 : 5,
        fontFamily: 'Georgia, serif', fontWeight: 900, lineHeight: 1.1, color }}>
        <div style={{ fontSize: rankFs }}>{rank}</div>
        <div style={{ fontSize: rankFs * 0.72 }}>{SUIT_SYMBOLS[card.suit]}</div>
      </div>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fs, color }}>
        {SUIT_SYMBOLS[card.suit]}
      </div>
      <div style={{ position: 'absolute', bottom: small ? 2 : 4, right: small ? 3 : 5,
        fontFamily: 'Georgia, serif', fontWeight: 900, lineHeight: 1.1, color, transform: 'rotate(180deg)' }}>
        <div style={{ fontSize: rankFs }}>{rank}</div>
        <div style={{ fontSize: rankFs * 0.72 }}>{SUIT_SYMBOLS[card.suit]}</div>
      </div>
    </div>
  );
}

// ─── Table felt ────────────────────────────────────────────────────────────────
function TableFelt({ children }) {
  return (
    <div style={{ position: 'relative', width: 680, height: 400, overflow: 'visible' }}>
      {/* Outer rail */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%',
        background: 'linear-gradient(145deg, #2d1a08, #1a0d03)',
        boxShadow: '0 0 0 6px #120800, 0 24px 80px rgba(0,0,0,0.9)',
      }} />
      {/* Felt */}
      <div style={{
        position: 'absolute', inset: 10, borderRadius: '50%',
        background: 'radial-gradient(ellipse at 40% 35%, #0d3520 0%, #071e0f 55%, #040e08 100%)',
        boxShadow: 'inset 0 2px 20px rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'visible',
      }}>
        {/* Watermark */}
        <div style={{
          position: 'absolute', opacity: 0.04, color: '#fff',
          fontWeight: 900, fontSize: 52, letterSpacing: '0.2em', userSelect: 'none',
          pointerEvents: 'none', whiteSpace: 'nowrap',
        }}>CRYPTO POKER</div>
        {children}
      </div>
    </div>
  );
}

// ─── Seat layout math ──────────────────────────────────────────────────────────
const TABLE_W = 680, TABLE_H = 400;
const CENTER_X = 50, CENTER_Y = 50;
const RIM_X = 47, RIM_Y = 46;
const PANEL_PUSH = 58; // px outside rim

function getSeatLayout(idx, total) {
  // Distribute seats around ellipse, bottom seat = "you"
  const startAngle = 90; // bottom = 0
  const deg = startAngle + (idx / total) * 360;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);

  const rimX = CENTER_X + RIM_X * cos;
  const rimY = CENTER_Y + RIM_Y * sin;

  const pushX = (PANEL_PUSH / TABLE_W) * 100;
  const pushY = (PANEL_PUSH / TABLE_H) * 100;
  const panelX = CENTER_X + (RIM_X + pushX) * cos;
  const panelY = CENTER_Y + (RIM_Y + pushY) * sin;

  return {
    icon:  { left: `${rimX}%`,  top: `${rimY}%`,  transform: 'translate(-50%,-50%)' },
    panel: { left: `${panelX}%`, top: `${panelY}%`, transform: 'translate(-50%,-50%)' },
  };
}

// Avatar gradient per address
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#00e676,#00b4d8)',
  'linear-gradient(135deg,#ff0070,#a855f7)',
  'linear-gradient(135deg,#f59e0b,#ef4444)',
  'linear-gradient(135deg,#00b4d8,#3b82f6)',
  'linear-gradient(135deg,#a855f7,#ec4899)',
  'linear-gradient(135deg,#22c55e,#3b82f6)',
  'linear-gradient(135deg,#f97316,#f59e0b)',
  'linear-gradient(135deg,#ec4899,#f97316)',
];

function getAvatar(address) {
  if (!address) return AVATAR_GRADIENTS[0];
  const idx = parseInt(address.slice(2, 6), 16) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[idx];
}

function getInitial(address) {
  if (!address) return '?';
  return address.slice(2, 3).toUpperCase();
}

// ─── Player seat ───────────────────────────────────────────────────────────────
function PlayerSeat({ player, idx, total, myAddress }) {
  if (!player) return null;
  const isMe = (player.address || '').toLowerCase() === (myAddress || '').toLowerCase();
  const layout = getSeatLayout(idx, total);
  const avatar = getAvatar(player.address);
  const initial = getInitial(player.address);

  return (
    <>
      {/* Avatar on rim */}
      <div style={{ position: 'absolute', zIndex: 20, ...layout.icon }}>
        <div style={{
          width: 44, height: 44, borderRadius: '50%',
          background: avatar,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 17, fontWeight: 900, color: '#000',
          border: player.isAction ? `2px solid #fbbf24` : isMe ? `2px solid ${G}` : '2px solid rgba(255,255,255,0.15)',
          boxShadow: player.isAction ? '0 0 0 3px rgba(251,191,36,0.3), 0 0 16px rgba(251,191,36,0.4)' : '0 4px 12px rgba(0,0,0,0.5)',
          opacity: player.folded ? 0.4 : 1,
          transition: 'all 0.3s',
        }}>
          {initial}
        </div>
        {player.isDealer && (
          <div style={{
            position: 'absolute', top: -4, right: -4,
            width: 16, height: 16, borderRadius: '50%',
            background: '#fff', border: '1px solid #ccc',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 8, fontWeight: 900, color: '#000',
          }}>D</div>
        )}
        {player.allIn && (
          <div style={{
            position: 'absolute', bottom: -6, left: '50%', transform: 'translateX(-50%)',
            background: '#ef4444', color: '#fff', fontSize: 7, fontWeight: 800,
            padding: '1px 5px', borderRadius: 3, whiteSpace: 'nowrap', letterSpacing: '0.1em',
          }}>ALL-IN</div>
        )}
      </div>

      {/* Info panel outside rim */}
      <div style={{ position: 'absolute', zIndex: 20, ...layout.panel }}>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
          padding: '6px 10px', borderRadius: 10, minWidth: 78,
          background: isMe ? 'rgba(0,230,118,0.08)' : 'rgba(0,0,0,0.7)',
          border: `1px solid ${isMe ? G + '30' : 'rgba(255,255,255,0.08)'}`,
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{
            color: isMe ? G : '#94a3b8', fontSize: 10, fontWeight: 700,
            fontFamily: 'Space Mono, monospace', letterSpacing: '0.05em',
            maxWidth: 74, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {isMe ? 'YOU' : `${player.address.slice(0,4)}…${player.address.slice(-3)}`}
          </div>
          <div style={{ color: '#fbbf24', fontSize: 12, fontWeight: 700, fontFamily: 'Space Mono, monospace' }}>
            ≡ {player.chips}
          </div>
          {player.bet > 0 && (
            <div style={{ color: G, fontSize: 10, fontFamily: 'Space Mono, monospace' }}>
              BET {player.bet}
            </div>
          )}
          {/* Cards */}
          {player.cards && player.cards.length > 0 && (
            <div style={{ display: 'flex', gap: 3 }}>
              {player.cards.map((card, i) => <Card key={i} card={card} small />)}
            </div>
          )}
          {player.cardCount > 0 && !player.cards && (
            <div style={{ display: 'flex', gap: 3 }}>
              {[...Array(player.cardCount)].map((_, i) => <Card key={i} hidden small />)}
            </div>
          )}
          {player.folded && (
            <div style={{ color: '#475569', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em' }}>FOLDED</div>
          )}
          {!player.connected && (
            <div style={{ color: '#f59e0b', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em' }}>AWAY</div>
          )}
        </div>
      </div>

      {/* Bet chip on table (between avatar and center) */}
      {player.bet > 0 && (
        <div style={{
          position: 'absolute', zIndex: 15,
          left: `calc(${layout.icon.left} + (50% - ${layout.icon.left}) * 0.35)`,
          top: `calc(${layout.icon.top} + (50% - ${layout.icon.top}) * 0.35)`,
          transform: 'translate(-50%,-50%)',
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
            border: '2px solid #92400e',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 8, fontWeight: 900, color: '#000',
            boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
          }}>
            {player.bet > 999 ? `${(player.bet/1000).toFixed(1)}k` : player.bet}
          </div>
        </div>
      )}
    </>
  );
}

// ─── Action Panel ──────────────────────────────────────────────────────────────
function ActionPanel({ gameState, myAddress, onAction }) {
  const [raiseAmt, setRaiseAmt] = useState('');
  const me = (myAddress || '').toLowerCase();
  const myPlayer = gameState?.players?.find(p => (p.address || '').toLowerCase() === me);
  const isMyTurn = myPlayer?.isAction;

  useEffect(() => { setRaiseAmt(''); }, [gameState?.currentBet]);

  if (!isMyTurn || gameState.stage === 'waiting' || gameState.stage === 'showdown') return null;

  const callAmt  = Math.max(0, gameState.currentBet - (myPlayer?.bet || 0));
  const minRaise = gameState.currentBet + gameState.config.bigBlind;
  const maxRaise = myPlayer?.chips || 0;
  const canCheck = callAmt <= 0;
  const sliderVal = raiseAmt ? Math.min(Math.max(Number(raiseAmt), minRaise), maxRaise) : minRaise;
  const sliderPct = maxRaise > minRaise ? ((sliderVal - minRaise) / (maxRaise - minRaise)) * 100 : 0;

  const PRESETS = [
    { label: 'MIN',   val: minRaise },
    { label: '1/2',   val: Math.round((gameState.pot || 0) / 2) },
    { label: '2/3',   val: Math.round((gameState.pot || 0) * 0.67) },
    { label: 'POT',   val: gameState.pot || 0 },
    { label: 'ALL-IN', val: maxRaise },
  ];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 24px', flexWrap: 'wrap', justifyContent: 'center' }}>
      {/* Fold */}
      <button onClick={() => onAction('fold')} style={{
        padding: '12px 28px', borderRadius: 8, fontWeight: 800, fontSize: 13, letterSpacing: '0.1em',
        background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#f87171',
        cursor: 'pointer', transition: 'all 0.15s',
      }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.2)'}
        onMouseLeave={e => e.currentTarget.style.background = 'rgba(239,68,68,0.12)'}>
        FOLD
      </button>

      {/* Check / Call */}
      {canCheck ? (
        <button onClick={() => onAction('check')} style={{
          padding: '12px 28px', borderRadius: 8, fontWeight: 800, fontSize: 13, letterSpacing: '0.1em',
          background: `${G}18`, border: `1px solid ${G}50`, color: G,
          cursor: 'pointer', transition: 'all 0.15s',
        }}
          onMouseEnter={e => e.currentTarget.style.background = `${G}28`}
          onMouseLeave={e => e.currentTarget.style.background = `${G}18`}>
          CHECK
        </button>
      ) : (
        <button onClick={() => onAction('call')} style={{
          padding: '12px 28px', borderRadius: 8, fontWeight: 800, fontSize: 13, letterSpacing: '0.1em',
          background: `${G}18`, border: `1px solid ${G}50`, color: G,
          cursor: 'pointer', transition: 'all 0.15s',
        }}
          onMouseEnter={e => e.currentTarget.style.background = `${G}28`}
          onMouseLeave={e => e.currentTarget.style.background = `${G}18`}>
          CALL ≡ {callAmt}
        </button>
      )}

      {/* Raise section */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Slider */}
        <input type="range" min={minRaise} max={maxRaise} value={sliderVal}
          onChange={e => setRaiseAmt(e.target.value)}
          style={{ width: 120, accentColor: G, cursor: 'pointer' }} />
        {/* Amount display */}
        <span style={{ color: '#e2e8f0', fontFamily: 'Space Mono, monospace', fontSize: 13, minWidth: 40 }}>
          ≡ {sliderVal}
        </span>
        {/* Raise button */}
        <button onClick={() => onAction('raise', sliderVal)} style={{
          padding: '12px 24px', borderRadius: 8, fontWeight: 800, fontSize: 13, letterSpacing: '0.1em',
          background: 'linear-gradient(135deg, #1d4ed8, #00b4d8)', color: '#fff',
          border: 'none', cursor: 'pointer',
        }}>
          RAISE ≡ {sliderVal}
        </button>
      </div>

      {/* Presets */}
      <div style={{ display: 'flex', gap: 4 }}>
        {PRESETS.map(({ label, val }) => (
          <button key={label} onClick={() => setRaiseAmt(String(Math.max(minRaise, Math.min(val, maxRaise))))} style={{
            padding: '5px 10px', borderRadius: 5, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#64748b',
            cursor: 'pointer', transition: 'all 0.15s',
          }}
            onMouseEnter={e => { e.currentTarget.style.color = '#e2e8f0'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#64748b'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Hand name helper ──────────────────────────────────────────────────────────
function getHandName(cards) {
  if (!cards || cards.length < 2) return null;
  const [a, b] = cards;
  if (!a || !b) return null;
  if (a.rank === b.rank) {
    const names = { A: 'POCKET ACES', K: 'POCKET KINGS', Q: 'POCKET QUEENS', J: 'POCKET JACKS', T: 'POCKET TENS' };
    return names[a.rank] || `POCKET ${a.rank}s`;
  }
  const suited = a.suit === b.suit;
  return `${RANK_DISPLAY[a.rank] || a.rank}${RANK_DISPLAY[b.rank] || b.rank} ${suited ? 'SUITED' : 'OFFSUIT'}`;
}

// ─── Main PokerTable ───────────────────────────────────────────────────────────
export default function PokerTable({ myAddress }) {
  const { gameState, playerAction, leaveTable, startGame, terminateGame, lastHand } = useGame();
  const [handHistory, setHandHistory] = useState([]);
  const [chatMessages, setChatMessages] = useState([
    { from: 'DEALER', text: 'Welcome to the table.', system: true },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [handResult, setHandResult] = useState(null);
  const [startError, setStartError] = useState(null);
  const chatRef = useRef(null);

  const tableId = gameState?.tableId;
  const isUsdcTable = typeof tableId === 'string' && tableId.startsWith('usdc-');
  const gameIdFromTable = isUsdcTable ? (parseInt(tableId.replace('usdc-', ''), 10) | 0) : null;
  const validGameId = gameIdFromTable != null && gameIdFromTable >= 0 ? gameIdFromTable : null;
  const vaultReady = !!ZAX_MIGGY_VAULT_ADDRESS && validGameId != null;

  const { data: rawGameData, isLoading: gameLoading, error: gameReadError } = useReadContract({
    address: vaultReady ? ZAX_MIGGY_VAULT_ADDRESS : undefined,
    abi: ZAX_MIGGY_VAULT_ABI,
    functionName: 'getGame',
    args: vaultReady ? [BigInt(validGameId)] : undefined,
  });

  const potUsdc = (() => {
    if (rawGameData == null) return null;
    const arr = Array.isArray(rawGameData) ? rawGameData : (rawGameData?.playerCount != null
      ? [rawGameData.players, rawGameData.playerCount, rawGameData.depositAmount, rawGameData.createdAt, rawGameData.finished, rawGameData.winner]
      : null);
    if (!arr) return null;
    const [, playerCount, depositAmount] = arr;
    if (depositAmount == null || playerCount == null) return null;
    const count = Number(playerCount);
    const deposit = typeof depositAmount === 'bigint' ? depositAmount : BigInt(depositAmount);
    return formatUnits(deposit * BigInt(count), USDC_DECIMALS);
  })();

  // Accumulate hand history
  useEffect(() => {
    if (!lastHand) return;
    setHandResult(lastHand);
    setTimeout(() => setHandResult(null), 5000);

    const winner = Object.entries(lastHand.results || {}).find(([, v]) => v.won > 0);
    if (winner) {
      const [addr, { won, hand }] = winner;
      const isMe = addr.toLowerCase() === (myAddress || '').toLowerCase();
      setHandHistory(h => [
        {
          hand: (lastHand.handNumber || h.length + 1),
          who: isMe ? 'you' : `${addr.slice(0,6)}…${addr.slice(-3)}`,
          amount: won,
          win: true,
          handName: hand?.name,
        },
        ...h.slice(0, 5),
      ]);
      setChatMessages(m => [
        ...m,
        { from: 'DEALER', text: `hand #${lastHand.handNumber || '—'} — ${hand?.name || 'winner'} wins ${won}`, system: true },
      ]);
    }
  }, [lastHand]);

  useEffect(() => {
    if (gameState?.stage && gameState.stage !== 'waiting') setStartError(null);
  }, [gameState?.stage]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chatMessages]);

  if (!gameState) return null;

  const { players, community, pot, stage, config: tableConfig } = gameState;
  const me = (myAddress || '').toLowerCase();
  const myPlayer = players.find(p => (p.address || '').toLowerCase() === me);
  const actionPlayer = players.find(p => p.isAction);
  const host = (gameState.hostId || '').toLowerCase();
  const isHost = !!me && host === me;
  const canManageTable = stage === 'waiting' && !!gameState.hostId;
  const canTerminate = stage === 'waiting' && !gameState.gameStarted;

  const STREET_LABELS = { preflop: 'PRE-FLOP', flop: 'FLOP', turn: 'TURN', river: 'RIVER', showdown: 'SHOWDOWN', waiting: 'WAITING' };
  const communityCount = community.filter(Boolean).length;
  const nextStreet = communityCount === 0 ? 'FLOP' : communityCount === 3 ? 'TURN' : communityCount === 4 ? 'RIVER' : 'SHOWDOWN';
  const streetLabel = stage !== 'waiting' && stage !== 'showdown'
    ? `${STREET_LABELS[stage] || stage} · WAITING FOR ${nextStreet}`
    : STREET_LABELS[stage] || stage;

  return (
    <div style={{
      height: 'calc(100vh - 60px)', display: 'flex', flexDirection: 'column',
      background: '#090d14', overflow: 'hidden',
    }}>
      {/* ── Info bar ── */}
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 20,
        padding: '0 20px', height: 44,
        background: '#0d1520', borderBottom: '1px solid rgba(255,255,255,0.06)',
        fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
      }}>
        {stage !== 'waiting' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: G, boxShadow: `0 0 6px ${G}` }} />
            <span style={{ color: G }}>LIVE</span>
          </div>
        )}
        <span style={{ color: '#475569' }}>·</span>
        <span style={{ color: '#94a3b8', textTransform: 'uppercase' }}>
          {isUsdcTable && validGameId != null
            ? gameIdToName(validGameId)
            : (tableConfig?.name?.toUpperCase() || 'TABLE')}
        </span>
        <span style={{ color: '#475569' }}>·</span>
        <span style={{ color: '#334155', fontFamily: 'Space Mono, monospace', fontSize: 10 }}>
          {isUsdcTable && validGameId != null ? `GAME #${validGameId}` : 'NLH 6-MAX'}
        </span>
        <span style={{ color: '#475569' }}>·</span>
        <span style={{ color: '#94a3b8' }}>NLH 6-MAX</span>
        <span style={{ color: '#475569' }}>·</span>
        <span style={{ color: '#475569' }}>STAKES ≡ {tableConfig?.smallBlind}/{tableConfig?.bigBlind}</span>
        {isUsdcTable && potUsdc != null && (
          <>
            <span style={{ color: '#475569' }}>·</span>
            <span style={{ color: G }}>≡ {Number(potUsdc).toFixed(2)} USDC</span>
          </>
        )}
        {actionPlayer && (
          <>
            <span style={{ color: '#475569' }}>·</span>
            <span style={{ color: '#fbbf24' }}>
              ⏳ {(actionPlayer.address || '').toLowerCase() === me ? 'YOUR TURN!' : `${(actionPlayer.address || '').slice(0,6)}...`}
            </span>
          </>
        )}
        {/* Spacer */}
        <div style={{ flex: 1 }} />
        {/* Right controls */}
        {canManageTable && isHost && (
          <button onClick={() => { setStartError(null); startGame().catch(e => setStartError(e.message || 'Could not start')); }}
            disabled={!players?.length || players.length < (tableConfig?.minPlayers ?? 2)}
            style={{
              padding: '5px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700,
              background: `${G}18`, border: `1px solid ${G}40`, color: G,
              cursor: 'pointer', opacity: players?.length < (tableConfig?.minPlayers ?? 2) ? 0.4 : 1,
            }}>
            START GAME
          </button>
        )}
        {canTerminate && isHost && (
          <button onClick={() => terminateGame().catch(console.error)} style={{
            padding: '5px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700,
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171',
            cursor: 'pointer',
          }}>
            TERMINATE
          </button>
        )}
        <button onClick={() => leaveTable()} style={{
          padding: '6px 16px', borderRadius: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171',
          cursor: 'pointer',
        }}>
          ⊗ LEAVE
        </button>
      </div>

      {startError && (
        <div style={{ background: 'rgba(245,158,11,0.1)', borderBottom: '1px solid rgba(245,158,11,0.3)', padding: '8px 20px', color: '#fbbf24', fontSize: 12, textAlign: 'center' }}>
          {startError}
        </div>
      )}

      {/* ── Main area: table (left) + panel (right) ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left: table + action */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Table canvas */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 20px 8px', overflow: 'hidden' }}>
            <div style={{ position: 'relative', overflow: 'visible', width: TABLE_W, height: TABLE_H, flexShrink: 0 }}>
              <TableFelt>
                {/* Community cards */}
                <div style={{ position: 'absolute', top: '38%', left: '50%', transform: 'translate(-50%,-50%)' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {[0,1,2,3,4].map(i => (
                      <div key={i} style={{ transition: 'transform 0.3s', transform: community[i] ? 'scale(1)' : 'scale(0.95)' }}>
                        {community[i]
                          ? <Card card={community[i]} />
                          : <div style={{ width: 56, height: 80, borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }} />
                        }
                      </div>
                    ))}
                  </div>
                  {stage !== 'waiting' && (
                    <div style={{ textAlign: 'center', marginTop: 10, color: '#475569', fontSize: 10, fontWeight: 700, letterSpacing: '0.2em' }}>
                      {streetLabel}
                    </div>
                  )}
                </div>

                {/* Pot */}
                {pot > 0 && (
                  <div style={{ position: 'absolute', top: '63%', left: '50%', transform: 'translate(-50%,-50%)' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ color: '#475569', fontSize: 9, fontWeight: 700, letterSpacing: '0.2em', marginBottom: 4 }}>MAIN POT</div>
                      <div style={{ color: G, fontWeight: 900, fontSize: 22, fontFamily: 'Space Mono, monospace', textShadow: `0 0 16px ${G}60` }}>
                        ≡ {pot}
                      </div>
                    </div>
                  </div>
                )}

                {/* Waiting message */}
                {stage === 'waiting' && (
                  <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center' }}>
                    <div style={{ color: '#334155', fontSize: 11, fontWeight: 700, letterSpacing: '0.2em' }}>
                      {canManageTable && !isHost ? 'WAITING FOR HOST TO START…' : canManageTable && isHost ? 'PRESS START GAME' : 'WAITING FOR PLAYERS…'}
                    </div>
                  </div>
                )}
              </TableFelt>

              {/* Player seats layer */}
              <div style={{ position: 'absolute', inset: 0, overflow: 'visible', zIndex: 10 }}>
                {players.map((player, i) => (
                  <PlayerSeat key={player.id} player={player} idx={i} total={players.length} myAddress={myAddress} />
                ))}
              </div>
            </div>
          </div>

          {/* Bottom action area */}
          <div style={{
            flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.05)',
            background: '#0a0e16', padding: '12px 0',
          }}>
            {/* Your hand display */}
            {myPlayer && myPlayer.cards && myPlayer.cards.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '0 24px 12px' }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  {myPlayer.cards.map((card, i) => <Card key={i} card={card} large />)}
                </div>
                <div>
                  <div style={{ color: '#475569', fontSize: 9, fontWeight: 700, letterSpacing: '0.18em', marginBottom: 4 }}>YOUR HAND</div>
                  <div style={{ color: G, fontWeight: 800, fontSize: 14, letterSpacing: '0.08em' }}>
                    {getHandName(myPlayer.cards) || 'HOLE CARDS'}
                  </div>
                </div>
              </div>
            )}
            <ActionPanel gameState={gameState} myAddress={myAddress}
              onAction={(action, amount) => playerAction(action, amount).catch(console.error)} />
          </div>
        </div>

        {/* Right panel: history + chat */}
        <div style={{
          width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column',
          borderLeft: '1px solid rgba(255,255,255,0.06)',
          background: '#0a0e16',
        }}>
          {/* Hand history */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ color: '#475569', fontSize: 10, fontWeight: 700, letterSpacing: '0.18em' }}>// HAND HISTORY</div>
              <div style={{ color: '#334155', fontSize: 10 }}>last 6</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {handHistory.length === 0 ? (
                <div style={{ color: '#1e3050', fontSize: 11, padding: '8px 0' }}>No hands played yet.</div>
              ) : handHistory.map((h, i) => (
                <div key={i} style={{
                  display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8,
                  alignItems: 'center', padding: '5px 0',
                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                }}>
                  <span style={{ color: '#334155', fontSize: 10, fontFamily: 'Space Mono, monospace' }}>#{h.hand}</span>
                  <span style={{ color: '#64748b', fontSize: 10 }}>{h.who}</span>
                  <span style={{ color: h.win ? G : P, fontSize: 10, fontFamily: 'Space Mono, monospace', fontWeight: 700 }}>
                    {h.win ? '+' : '-'}≡ {Math.abs(h.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Chat */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px 6px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ color: '#475569', fontSize: 10, fontWeight: 700, letterSpacing: '0.18em' }}>// TABLE CHAT</div>
            </div>
            <div ref={chatRef} style={{ flex: 1, overflowY: 'auto', padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {chatMessages.map((msg, i) => (
                <div key={i} style={{ fontSize: 11, lineHeight: 1.5 }}>
                  {msg.system ? (
                    <span style={{ color: '#334155', fontFamily: 'Space Mono, monospace', fontSize: 10 }}>{msg.text}</span>
                  ) : (
                    <>
                      <span style={{ color: G, fontWeight: 700, marginRight: 6, fontSize: 10 }}>{msg.from}:</span>
                      <span style={{ color: '#94a3b8' }}>{msg.text}</span>
                    </>
                  )}
                </div>
              ))}
            </div>
            <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: 6 }}>
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && chatInput.trim()) {
                    const tag = myAddress ? `${myAddress.slice(0,6)}…` : 'YOU';
                    setChatMessages(m => [...m, { from: tag, text: chatInput.trim() }]);
                    setChatInput('');
                  }
                }}
                placeholder="Type message…"
                style={{
                  flex: 1, background: '#060d14', border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: 6, padding: '7px 10px', color: '#e2e8f0', fontSize: 12, outline: 'none',
                }} />
              <button onClick={() => {
                if (!chatInput.trim()) return;
                const tag = myAddress ? `${myAddress.slice(0,6)}…` : 'YOU';
                setChatMessages(m => [...m, { from: tag, text: chatInput.trim() }]);
                setChatInput('');
              }} style={{
                width: 32, height: 32, borderRadius: 6, background: `${G}18`, border: `1px solid ${G}30`,
                color: G, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>↑</button>
            </div>
          </div>
        </div>
      </div>

      {/* Hand result overlay */}
      {handResult && (
        <div style={{
          position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 50, pointerEvents: 'none',
        }}>
          <div className="fade-in" style={{
            borderRadius: 16, padding: '24px 32px', textAlign: 'center',
            background: 'rgba(9,13,20,0.92)', border: `1px solid ${G}40`,
            boxShadow: `0 0 40px ${G}20`, backdropFilter: 'blur(16px)',
          }}>
            <div style={{ color: G, fontSize: 12, fontWeight: 700, letterSpacing: '0.2em', marginBottom: 12 }}>HAND COMPLETE</div>
            {Object.entries(handResult.results || {}).map(([addr, { won, hand }]) => (
              <div key={addr} style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
                <span style={{ color: '#64748b', fontSize: 12, fontFamily: 'Space Mono, monospace' }}>{addr.slice(0,8)}…</span>
                {won > 0 && <span style={{ color: G, fontWeight: 700, fontSize: 13 }}>+{won}</span>}
                {hand && <span style={{ color: '#a855f7', fontSize: 11 }}>({hand.name})</span>}
                {Array.isArray(handResult?.holeCards?.[addr]) && handResult.holeCards[addr].length > 0 && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    {handResult.holeCards[addr].map((card, i) => <Card key={i} card={card} small />)}
                  </div>
                )}
              </div>
            ))}
            {handResult.verify && (
              <div style={{ color: '#334155', fontSize: 10, marginTop: 10, fontFamily: 'Space Mono, monospace' }}>
                seed: {handResult.verify.serverSeed?.slice(0,16)}…
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
