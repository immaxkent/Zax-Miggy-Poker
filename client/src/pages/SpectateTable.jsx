import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import { SOCKET_URL, SERVER_API_KEY } from '../utils/web3Config';
import { gameIdToName } from './Lobby';

const G = '#00e676';
const P = '#ff0070';

const SUIT_COLORS  = { s: '#0f1a2e', h: '#dc2626', d: '#dc2626', c: '#0f1a2e' };
const SUIT_SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RANK_DISPLAY = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };
const AVATAR_SIZE  = 52;
const AVATAR_R     = AVATAR_SIZE / 2;
const GRADS = [
  'linear-gradient(135deg,#00e676,#00b4d8)', 'linear-gradient(135deg,#ff0070,#a855f7)',
  'linear-gradient(135deg,#f59e0b,#ef4444)', 'linear-gradient(135deg,#00b4d8,#3b82f6)',
  'linear-gradient(135deg,#a855f7,#ec4899)', 'linear-gradient(135deg,#22c55e,#3b82f6)',
  'linear-gradient(135deg,#f97316,#f59e0b)', 'linear-gradient(135deg,#ec4899,#f97316)',
];
const avatarGrad = a => GRADS[a ? parseInt(a.slice(2, 6), 16) % GRADS.length : 0];
const initial    = a => a ? a.slice(2, 3).toUpperCase() : '?';

function Card({ card, hidden, size = 'md' }) {
  const dims = {
    sm: { w: 36, h: 50,  iconFs: 18, rankFs: 10 },
    md: { w: 54, h: 76,  iconFs: 26, rankFs: 13 },
    lg: { w: 70, h: 98,  iconFs: 32, rankFs: 16 },
  };
  const { w, h, iconFs, rankFs } = dims[size] || dims.md;
  if (!card && !hidden) return null;
  if (hidden || !card) {
    return (
      <div style={{
        width: w, height: h, borderRadius: 7, flexShrink: 0,
        background: 'linear-gradient(160deg,#1c0838 0%,#3b0a6e 50%,#1c0838 100%)',
        border: `1.5px solid ${P}50`,
        boxShadow: `0 3px 12px rgba(0,0,0,0.6), 0 0 10px ${P}15`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          width: '74%', height: '74%', borderRadius: 5,
          border: `1px solid ${P}30`,
          background: `repeating-linear-gradient(45deg,transparent,transparent 3px,${P}0e 3px,${P}0e 4px)`,
        }} />
      </div>
    );
  }
  const col  = SUIT_COLORS[card.suit];
  const rank = RANK_DISPLAY[card.rank] || card.rank;
  return (
    <div style={{
      width: w, height: h, borderRadius: 7, flexShrink: 0,
      position: 'relative', overflow: 'hidden',
      background: 'linear-gradient(170deg,#ffffff 0%,#f2f2f2 100%)',
      border: '1px solid #ccc', boxShadow: '0 3px 12px rgba(0,0,0,0.55)', color: col,
    }}>
      <div style={{ position: 'absolute', top: 3, left: 4, fontFamily: 'Georgia,serif', fontWeight: 900, lineHeight: 1.05, color: col }}>
        <div style={{ fontSize: rankFs }}>{rank}</div>
        <div style={{ fontSize: rankFs * 0.8 }}>{SUIT_SYMBOLS[card.suit]}</div>
      </div>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: iconFs, color: col }}>
        {SUIT_SYMBOLS[card.suit]}
      </div>
      <div style={{ position: 'absolute', bottom: 3, right: 4, fontFamily: 'Georgia,serif', fontWeight: 900, lineHeight: 1.05, color: col, transform: 'rotate(180deg)' }}>
        <div style={{ fontSize: rankFs }}>{rank}</div>
        <div style={{ fontSize: rankFs * 0.8 }}>{SUIT_SYMBOLS[card.suit]}</div>
      </div>
    </div>
  );
}

export default function SpectateTable() {
  const { gameId } = useParams();
  const [state, setState]           = useState(null);
  const [connected, setConnected]   = useState(false);
  const [notFound, setNotFound]     = useState(false);
  const [handResult, setHandResult] = useState(null);
  const [handHistory, setHandHistory] = useState([]);
  const [size, setSize]             = useState({ w: 800, h: 460 });
  const tableRef = useRef(null);
  const socketRef = useRef(null);

  // Measure table container
  useEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Socket connection
  useEffect(() => {
    if (!gameId) return;
    const socket = io(`${SOCKET_URL}/spectate`, {
      auth: { apiKey: SERVER_API_KEY },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionAttempts: 10,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('spectate', { gameId: Number(gameId) }, (res) => {
        if (res && !res.found) setNotFound(true);
      });
    });
    socket.on('disconnect', () => setConnected(false));

    socket.on('spectatorState', (s) => {
      setState(s);
      setNotFound(false);
    });

    socket.on('spectatorHandComplete', (result) => {
      setHandResult(result);
      const payouts = Object.entries(result.results || {})
        .filter(([, v]) => (v?.won || 0) > 0)
        .map(([addr, { won, hand }]) => ({
          addr,
          who: `${addr.slice(0, 6)}…${addr.slice(-3)}`,
          won,
          handName: hand?.name || null,
          cards: result.holeCards?.[addr] || [],
        }));
      if (payouts.length > 0) {
        setHandHistory(h => [
          { hand: result.handNumber || h.length + 1, payouts },
          ...h.slice(0, 11),
        ]);
      }
      setTimeout(() => setHandResult(null), 7000);
    });

    return () => { socket.disconnect(); socketRef.current = null; };
  }, [gameId]);

  // Table geometry (identical to PokerTable)
  const { w, h } = size;
  const cx = w / 2, cy = h / 2;
  const fw = Math.min(w * 0.68, w - 110);
  const fh = Math.min(h * 0.62, h - 110);
  const fLeft = cx - fw / 2;
  const fTop  = cy - fh / 2;
  const RAIL  = 36;

  function seatPos(idx, total) {
    const perimeter   = 2 * (fw + fh);
    const startOffset = fw * 1.5 + fh;
    const d = ((idx / total) * perimeter + startOffset) % perimeter;
    let px, py, nx, ny;
    if (d < fw) {
      px = fLeft + d; py = fTop; nx = 0; ny = -1;
    } else if (d < fw + fh) {
      px = fLeft + fw; py = fTop + (d - fw); nx = 1; ny = 0;
    } else if (d < 2 * fw + fh) {
      px = fLeft + fw - (d - fw - fh); py = fTop + fh; nx = 0; ny = 1;
    } else {
      px = fLeft; py = fTop + fh - (d - 2 * fw - fh); nx = -1; ny = 0;
    }
    const ax = px + nx * RAIL, ay = py + ny * RAIL;
    const dx = cx - ax, dy = cy - ay;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return { ax, ay, cos: dist > 0 ? dx / dist : 0, sin: dist > 0 ? dy / dist : 0 };
  }

  const gameName = gameIdToName(Number(gameId)).toUpperCase();

  if (!connected && !state) {
    return (
      <div style={{ height: 'calc(100vh - 60px)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#090d14', flexDirection: 'column', gap: 16 }}>
        <div style={{ color: '#334155', fontSize: 13, fontWeight: 700, letterSpacing: '0.18em' }}>
          {notFound ? 'GAME NOT FOUND OR NOT YET STARTED' : 'CONNECTING…'}
        </div>
        <Link to="/lobby" style={{ color: G, fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textDecoration: 'none' }}>← BACK TO LOBBY</Link>
      </div>
    );
  }

  const players   = state?.players || [];
  const community = state?.community || [];
  const pot       = state?.pot || 0;
  const stage     = state?.stage || 'waiting';
  const streetLabel = stage !== 'waiting' && stage !== 'showdown' ? stage.toUpperCase() : stage === 'showdown' ? 'SHOWDOWN' : '';

  return (
    <div style={{
      height: 'calc(100vh - 60px)', display: 'flex', flexDirection: 'column',
      background: '#090d14', overflow: 'hidden',
      fontFamily: "'Space Grotesk','Outfit',sans-serif",
    }}>

      {/* Top bar */}
      <div style={{
        flexShrink: 0, height: 44,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: '#0b1018', borderBottom: '1px solid rgba(255,255,255,0.05)',
        padding: '0 16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: connected ? '#a855f7' : '#475569', boxShadow: connected ? '0 0 6px #a855f7' : 'none' }} />
            <span style={{ color: '#a855f7', fontSize: 10, fontWeight: 700, letterSpacing: '0.14em' }}>SPECTATING</span>
          </div>
          <span style={{ color: '#1e3050' }}>·</span>
          <span style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700 }}>{gameName}</span>
          <span style={{ color: '#1e3050' }}>·</span>
          <span style={{ color: '#334155', fontSize: 11, fontFamily: 'Space Mono,monospace' }}>#{gameId}</span>
          {stage !== 'waiting' && (
            <>
              <span style={{ color: '#1e3050' }}>·</span>
              <span style={{ color: G, fontSize: 10, fontWeight: 700, letterSpacing: '0.14em' }}>LIVE</span>
            </>
          )}
          <span style={{ color: '#1e3050' }}>·</span>
          <span style={{ color: '#475569', fontSize: 11 }}>{players.length} players</span>
        </div>
        <Link to="/lobby" style={{
          padding: '5px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700,
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
          color: '#475569', textDecoration: 'none', letterSpacing: '0.08em',
        }}>← LOBBY</Link>
      </div>

      {/* Main row */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* Table area */}
        <div style={{ flex: 1, maxWidth: 980, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <div
            ref={tableRef}
            style={{
              flex: 1, position: 'relative', overflow: 'hidden',
              margin: '10px 10px 6px 10px', borderRadius: 12,
              background: 'linear-gradient(160deg,#0a1929 0%,#071422 100%)',
              border: '1.5px solid rgba(168,85,247,0.35)',
              boxShadow: ['0 0 0 3px rgba(168,85,247,0.05)', '0 0 40px rgba(0,0,0,0.9)', 'inset 0 0 80px rgba(0,0,0,0.5)'].join(', '),
            }}
          >
            {/* Felt */}
            <div style={{
              position: 'absolute', pointerEvents: 'none',
              left: fLeft, top: fTop, width: fw, height: fh,
              borderRadius: 18,
              background: 'radial-gradient(ellipse at 50% 40%,#1a5c2a 0%,#0d3518 55%,#061609 100%)',
              border: '2px solid rgba(168,85,247,0.4)',
              boxShadow: '0 0 0 5px rgba(168,85,247,0.05), inset 0 0 60px rgba(0,0,0,0.45)',
              overflow: 'hidden',
            }}>
              <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(0deg,transparent,transparent 20px,rgba(255,255,255,0.008) 20px,rgba(255,255,255,0.008) 21px)' }} />
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', color: '#fff', opacity: 0.015, fontWeight: 900, fontSize: Math.max(18, fw * 0.06), letterSpacing: '0.22em', userSelect: 'none', whiteSpace: 'nowrap' }}>SPECTATING</div>
            </div>

            {/* Community cards */}
            {stage !== 'waiting' && (
              <div style={{ position: 'absolute', pointerEvents: 'none', left: cx, top: cy - 18, transform: 'translate(-50%,-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[0, 1, 2, 3, 4].map(i => community[i] ? (
                    <Card key={i} card={community[i]} size="md" />
                  ) : (
                    <div key={i} style={{ width: 54, height: 76, borderRadius: 7, border: '1px solid rgba(255,255,255,0.04)', background: 'rgba(0,0,0,0.18)' }} />
                  ))}
                </div>
                {streetLabel && <div style={{ color: 'rgba(168,85,247,0.7)', fontSize: 10, fontWeight: 700, letterSpacing: '0.22em' }}>{streetLabel}</div>}
              </div>
            )}

            {/* Pot */}
            {pot > 0 && stage !== 'waiting' && (
              <div style={{ position: 'absolute', pointerEvents: 'none', left: cx, top: cy + 56, transform: 'translate(-50%,-50%)', textAlign: 'center' }}>
                <div style={{ color: 'rgba(255,255,255,0.18)', fontSize: 9, fontWeight: 700, letterSpacing: '0.22em', marginBottom: 2 }}>MAIN POT</div>
                <div style={{ color: '#a855f7', fontWeight: 900, fontSize: Math.max(18, fw * 0.045), fontFamily: 'Space Mono,monospace', textShadow: '0 0 20px rgba(168,85,247,0.55)' }}>≡ {pot}</div>
              </div>
            )}

            {stage === 'waiting' && (
              <div style={{ position: 'absolute', pointerEvents: 'none', left: cx, top: cy, transform: 'translate(-50%,-50%)', textAlign: 'center' }}>
                <div style={{ color: 'rgba(255,255,255,0.1)', fontSize: 12, fontWeight: 700, letterSpacing: '0.24em' }}>WAITING FOR GAME TO START…</div>
              </div>
            )}

            {/* Player stations */}
            {players.map((player, i) => {
              const { ax, ay, cos, sin } = seatPos(i, players.length);
              const grad = avatarGrad(player.address);
              const init = initial(player.address);
              const revealedCards = handResult?.holeCards?.[player.id] || handResult?.holeCards?.[player.address] || null;

              return (
                <div key={player.id || i}>
                  {/* Hole cards — face-down, or revealed at showdown */}
                  {(player.cardCount > 0 || player.cards?.length > 0) && !player.folded && (
                    <div style={{
                      position: 'absolute',
                      left: ax + (-cos) * (AVATAR_R + 22),
                      top:  ay + (-sin) * (AVATAR_R + 22),
                      transform: 'translate(-50%,-50%)',
                      display: 'flex', gap: 3, zIndex: 19,
                      pointerEvents: 'none',
                    }}>
                      {revealedCards?.length > 0
                        ? revealedCards.map((c, ci) => <Card key={ci} card={c} size="sm" />)
                        : [...Array(player.cardCount || 2)].map((_, ci) => <Card key={ci} hidden size="sm" />)
                      }
                    </div>
                  )}

                  {/* Avatar */}
                  <div style={{
                    position: 'absolute', left: ax, top: ay,
                    transform: 'translate(-50%,-50%)',
                    width: AVATAR_SIZE, height: AVATAR_SIZE,
                    borderRadius: '50%', background: grad,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, fontWeight: 900, color: '#fff',
                    textShadow: '0 1px 4px rgba(0,0,0,0.7)',
                    border: player.isAction ? '3px solid #fbbf24' : '2px solid rgba(255,255,255,0.1)',
                    boxShadow: player.isAction
                      ? '0 0 0 5px rgba(251,191,36,0.15), 0 0 30px rgba(251,191,36,0.5)'
                      : '0 6px 20px rgba(0,0,0,0.8)',
                    opacity: player.folded ? 0.35 : 1,
                    transition: 'box-shadow 0.3s, opacity 0.3s',
                    zIndex: 20,
                  }}>
                    {init}
                    {player.isDealer && (
                      <div style={{ position: 'absolute', top: -5, right: -5, width: 16, height: 16, borderRadius: '50%', background: '#fff', border: '1.5px solid #999', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 900, color: '#111', boxShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>D</div>
                    )}
                    {player.allIn && !player.folded && (
                      <div style={{ position: 'absolute', bottom: -10, left: '50%', transform: 'translateX(-50%)', background: '#dc2626', color: '#fff', fontSize: 7, fontWeight: 800, padding: '1px 5px', borderRadius: 3, whiteSpace: 'nowrap', letterSpacing: '0.06em' }}>ALL-IN</div>
                    )}
                  </div>

                  {/* Info label */}
                  <div style={{ position: 'absolute', left: ax, top: ay + AVATAR_R + 8, transform: 'translateX(-50%)', zIndex: 18, pointerEvents: 'none', textAlign: 'center' }}>
                    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 1, padding: '4px 10px 5px', borderRadius: 8, background: 'rgba(4,8,18,0.90)', border: '1px solid rgba(255,255,255,0.07)', backdropFilter: 'blur(8px)', minWidth: 62 }}>
                      <div style={{ fontSize: 9, fontWeight: 800, color: '#e2e8f0', fontFamily: 'Space Mono,monospace', letterSpacing: '0.05em', maxWidth: 76, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {`${(player.address || '').slice(0, 5)}…${(player.address || '').slice(-3)}`}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#fbbf24', fontFamily: 'Space Mono,monospace' }}>≡ {player.chips}</div>
                      {player.folded && <div style={{ fontSize: 8, color: '#475569', fontWeight: 800, letterSpacing: '0.1em' }}>FOLD</div>}
                    </div>
                  </div>

                  {/* Bet chip */}
                  {player.bet > 0 && (
                    <div style={{ position: 'absolute', left: cx + (ax - cx) * 0.48, top: cy + (ay - cy) * 0.48, transform: 'translate(-50%,-50%)', zIndex: 16 }}>
                      <div style={{ minWidth: 28, height: 28, borderRadius: 14, padding: '0 6px', background: 'linear-gradient(135deg,#fbbf24,#f59e0b)', border: '2px solid #92400e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 900, color: '#000', boxShadow: '0 2px 8px rgba(0,0,0,0.7)', whiteSpace: 'nowrap' }}>
                        {player.bet > 9999 ? `${(player.bet / 1000).toFixed(0)}k` : player.bet}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Spectating banner (replaces action bar) */}
          <div style={{
            flexShrink: 0, margin: '0 10px 10px',
            background: '#0a0e18', borderRadius: 14,
            border: '1px solid rgba(168,85,247,0.15)',
            padding: '14px 20px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            minHeight: 60,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#a855f7', boxShadow: '0 0 8px #a855f7', animation: 'pulse 2s infinite' }} />
              <span style={{ color: '#a855f7', fontSize: 12, fontWeight: 700, letterSpacing: '0.16em' }}>SPECTATING LIVE</span>
              <span style={{ color: '#1e3050' }}>·</span>
              <span style={{ color: '#334155', fontSize: 11 }}>CARDS HIDDEN UNTIL SHOWDOWN</span>
            </div>
            <div style={{ color: '#334155', fontSize: 11, fontFamily: 'Space Mono,monospace' }}>
              HAND #{state?.handNumber || '—'}
            </div>
          </div>
        </div>

        {/* Right panel — hand history */}
        <div style={{ width: 258, flexShrink: 0, display: 'flex', flexDirection: 'column', borderLeft: '1px solid rgba(255,255,255,0.05)', background: '#0a0e16' }}>
          <div style={{ padding: '10px 16px 8px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <span style={{ color: '#334155', fontSize: 10, fontWeight: 700, letterSpacing: '0.18em' }}>// HAND HISTORY</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 7 }}>
            {handHistory.length === 0 ? (
              <div style={{ color: '#1e3050', fontSize: 11, padding: '4px 0' }}>No hands completed yet.</div>
            ) : (
              handHistory.map((hh, i) => (
                <div key={i} style={{ padding: '8px 8px 7px', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 8, background: 'rgba(3,8,16,0.6)' }}>
                  <div style={{ color: '#64748b', fontSize: 10, fontFamily: 'Space Mono,monospace', marginBottom: 5 }}>HAND #{hh.hand}</div>
                  {hh.payouts.map((p, idx) => (
                    <div key={idx} style={{ marginBottom: idx < hh.payouts.length - 1 ? 6 : 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                        <span style={{ color: '#94a3b8', fontSize: 10, fontWeight: 700 }}>{p.who}</span>
                        <span style={{ color: G, fontSize: 11, fontFamily: 'Space Mono,monospace', fontWeight: 700 }}>+≡{p.won}</span>
                      </div>
                      {p.handName && <div style={{ color: '#7c3aed', fontSize: 9, marginBottom: 3 }}>{p.handName}</div>}
                      {p.cards?.length > 0 && (
                        <div style={{ display: 'flex', gap: 3, marginTop: 2 }}>
                          {p.cards.map((c, ci) => <Card key={ci} card={c} size="sm" />)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Showdown reveal overlay */}
      {handResult && (
        <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, pointerEvents: 'none' }}>
          <div style={{
            borderRadius: 16, padding: '24px 36px', textAlign: 'center',
            background: 'rgba(9,13,20,0.96)', border: '1px solid rgba(168,85,247,0.4)',
            boxShadow: '0 0 60px rgba(168,85,247,0.18)', backdropFilter: 'blur(20px)',
          }}>
            <div style={{ color: '#a855f7', fontSize: 11, fontWeight: 700, letterSpacing: '0.22em', marginBottom: 14 }}>SHOWDOWN</div>
            {Object.entries(handResult.results || {}).map(([addr, { won, hand }]) => (
              <div key={addr} style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
                <span style={{ color: '#475569', fontSize: 12, fontFamily: 'Space Mono,monospace' }}>{addr.slice(0, 10)}…</span>
                {won > 0 && <span style={{ color: G, fontWeight: 700, fontSize: 14 }}>+{won}</span>}
                {hand && <span style={{ color: '#a855f7', fontSize: 11 }}>({hand.name})</span>}
                {Array.isArray(handResult.holeCards?.[addr]) && handResult.holeCards[addr].length > 0 && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    {handResult.holeCards[addr].map((c, ci) => <Card key={ci} card={c} size="sm" />)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
