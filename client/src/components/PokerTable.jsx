import { useState, useEffect, useRef } from 'react';
import { useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { useGame } from '../context/GameContext';
import { ZAX_MIGGY_VAULT_ADDRESS, ZAX_MIGGY_VAULT_ABI, USDC_DECIMALS } from '../utils/web3Config';
import { gameIdToName } from '../pages/Lobby';

const G = '#00e676';
const P = '#ff0070';

const SUIT_COLORS  = { s: '#0f1a2e', h: '#dc2626', d: '#dc2626', c: '#0f1a2e' };
const SUIT_SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RANK_DISPLAY = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };

const AVATAR_SIZE = 52;
const AVATAR_R    = AVATAR_SIZE / 2;

const GRADS = [
  'linear-gradient(135deg,#00e676,#00b4d8)',
  'linear-gradient(135deg,#ff0070,#a855f7)',
  'linear-gradient(135deg,#f59e0b,#ef4444)',
  'linear-gradient(135deg,#00b4d8,#3b82f6)',
  'linear-gradient(135deg,#a855f7,#ec4899)',
  'linear-gradient(135deg,#22c55e,#3b82f6)',
  'linear-gradient(135deg,#f97316,#f59e0b)',
  'linear-gradient(135deg,#ec4899,#f97316)',
];
const avatarGrad = a => GRADS[a ? parseInt(a.slice(2,6), 16) % GRADS.length : 0];
const initial    = a => a ? a.slice(2, 3).toUpperCase() : '?';

// ─── Card ──────────────────────────────────────────────────────────────────────
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
        }}/>
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
      border: '1px solid #ccc',
      boxShadow: '0 3px 12px rgba(0,0,0,0.55)',
      color: col,
    }}>
      <div style={{ position:'absolute', top:3, left:4, fontFamily:'Georgia,serif', fontWeight:900, lineHeight:1.05, color:col }}>
        <div style={{ fontSize:rankFs }}>{rank}</div>
        <div style={{ fontSize:rankFs*0.8 }}>{SUIT_SYMBOLS[card.suit]}</div>
      </div>
      <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:iconFs, color:col }}>
        {SUIT_SYMBOLS[card.suit]}
      </div>
      <div style={{ position:'absolute', bottom:3, right:4, fontFamily:'Georgia,serif', fontWeight:900, lineHeight:1.05, color:col, transform:'rotate(180deg)' }}>
        <div style={{ fontSize:rankFs }}>{rank}</div>
        <div style={{ fontSize:rankFs*0.8 }}>{SUIT_SYMBOLS[card.suit]}</div>
      </div>
    </div>
  );
}

// ─── Hand name ─────────────────────────────────────────────────────────────────
function handName(cards) {
  if (!cards || cards.length < 2 || !cards[0] || !cards[1]) return 'HOLE CARDS';
  const [a, b] = cards;
  if (a.rank === b.rank) {
    const n = { A:'POCKET ACES', K:'POCKET KINGS', Q:'POCKET QUEENS', J:'POCKET JACKS', T:'POCKET TENS' };
    return n[a.rank] || `POCKET ${a.rank}S`;
  }
  return `${RANK_DISPLAY[a.rank]||a.rank}${RANK_DISPLAY[b.rank]||b.rank} ${a.suit===b.suit?'SUITED':'OFFSUIT'}`;
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function PokerTable({ myAddress }) {
  const { gameState, playerAction, leaveTable, startGame, terminateGame, lastHand } = useGame();
  const [handHistory,  setHandHistory]  = useState([]);
  const [chatMessages, setChatMessages] = useState([{ from:'DEALER', text:'Welcome to the table.', system:true }]);
  const [chatInput,    setChatInput]    = useState('');
  const [handResult,   setHandResult]   = useState(null);
  const [startError,   setStartError]   = useState(null);
  const [raiseAmt,     setRaiseAmt]     = useState('');
  // Container dimensions — updated by ResizeObserver, drives all geometry at 1:1 pixel scale
  const [size, setSize] = useState({ w: 800, h: 460 });

  const tableRef = useRef(null);
  const chatRef  = useRef(null);

  // ── Measure table container at actual pixel size (no CSS scale) ──────────────
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

  // ── On-chain data ────────────────────────────────────────────────────────────
  const tableId     = gameState?.tableId;
  const isUsdc      = typeof tableId === 'string' && tableId.startsWith('usdc-');
  const gameIdNum   = isUsdc ? (parseInt(tableId.replace('usdc-',''), 10) | 0) : null;
  const validGameId = gameIdNum != null && gameIdNum >= 0 ? gameIdNum : null;
  const vaultReady  = !!ZAX_MIGGY_VAULT_ADDRESS && validGameId != null;

  const { data: rawGameData } = useReadContract({
    address:      vaultReady ? ZAX_MIGGY_VAULT_ADDRESS : undefined,
    abi:          ZAX_MIGGY_VAULT_ABI,
    functionName: 'getGame',
    args:         vaultReady ? [BigInt(validGameId)] : undefined,
  });

  const potUsdc = (() => {
    if (!rawGameData) return null;
    const arr = Array.isArray(rawGameData) ? rawGameData
      : rawGameData?.playerCount != null
        ? [rawGameData.players, rawGameData.playerCount, rawGameData.depositAmount,
           rawGameData.createdAt, rawGameData.finished, rawGameData.winner]
        : null;
    if (!arr) return null;
    const [, playerCount, depositAmount] = arr;
    if (!depositAmount || !playerCount) return null;
    const dep = typeof depositAmount === 'bigint' ? depositAmount : BigInt(depositAmount);
    return formatUnits(dep * BigInt(Number(playerCount)), USDC_DECIMALS);
  })();

  // ── Hand history ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!lastHand) return;
    setHandResult(lastHand);
    setTimeout(() => setHandResult(null), 5500);
    const winner = Object.entries(lastHand.results||{}).find(([,v]) => v.won > 0);
    if (winner) {
      const [addr, { won, hand }] = winner;
      const isMe = addr.toLowerCase() === (myAddress||'').toLowerCase();
      setHandHistory(h => [{ hand: lastHand.handNumber||h.length+1, who: isMe?'you':`${addr.slice(0,6)}…`, amount:won, win:true, handName:hand?.name }, ...h.slice(0,5)]);
      setChatMessages(m => [...m, { from:'DEALER', text:`hand #${lastHand.handNumber||'—'} — ${hand?.name||'winner'} wins ${won}`, system:true }]);
    }
  }, [lastHand]);

  useEffect(() => { if (gameState?.stage && gameState.stage !== 'waiting') setStartError(null); }, [gameState?.stage]);
  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [chatMessages]);
  useEffect(() => { setRaiseAmt(''); }, [gameState?.currentBet]);

  if (!gameState) return null;

  const { players, community, pot, stage, config: cfg } = gameState;
  const me           = (myAddress||'').toLowerCase();
  const myPlayer     = players.find(p => (p.address||'').toLowerCase() === me);
  const actionPlayer = players.find(p => p.isAction);
  const isHost       = !!me && (gameState.hostId||'').toLowerCase() === me;
  const canManage    = stage === 'waiting' && !!gameState.hostId;
  const canTerminate = stage === 'waiting' && !gameState.gameStarted;
  const gameName     = isUsdc && validGameId != null ? gameIdToName(validGameId).toUpperCase() : (cfg?.name?.toUpperCase()||'TABLE');

  // ── Action state ─────────────────────────────────────────────────────────────
  const showActions = !!myPlayer?.isAction && !['waiting','showdown'].includes(stage);
  const callAmt     = myPlayer ? Math.max(0, (gameState.currentBet||0) - (myPlayer.bet||0)) : 0;
  const minRaise    = (gameState.currentBet||0) + (cfg?.bigBlind||0);
  const maxChips    = myPlayer?.chips || 0;
  const canCheck    = callAmt <= 0;
  const rVal        = raiseAmt ? Math.min(Math.max(Number(raiseAmt), minRaise), maxChips) : minRaise;

  const PRESETS = [
    { l:'MIN', v: minRaise },
    { l:'½',   v: Math.round((pot||0) * 0.5) },
    { l:'⅔',   v: Math.round((pot||0) * 0.67) },
    { l:'POT', v: pot || 0 },
    { l:'MAX', v: maxChips },
  ];

  // ── Table geometry — derived from actual container size, no scaling ───────────
  const { w, h } = size;
  const cx = w / 2;
  const cy = h / 2;
  // Oval semi-axes: x is 37% of container width, y is 56% of x (standard poker oval ratio)
  const rx = Math.min(w * 0.37, h * 0.58);
  const ry = rx * 0.56;
  const PUSH = 58; // px outside the oval rim where avatar center lives

  function seatPos(idx, total) {
    const deg = 90 + (idx / total) * 360;
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
      ax: cx + (rx + PUSH) * cos,
      ay: cy + (ry + PUSH) * sin,
      cos,
      sin,
    };
  }

  const streetLabel = stage !== 'waiting' && stage !== 'showdown'
    ? stage.toUpperCase()
    : stage === 'showdown' ? 'SHOWDOWN' : '';

  return (
    <div style={{
      height: 'calc(100vh - 60px)', display: 'flex', flexDirection: 'column',
      background: '#090d14', overflow: 'hidden',
      fontFamily: "'Space Grotesk','Outfit',sans-serif",
    }}>

      {/* ── Top info bar ───────────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0, height: 44,
        display: 'flex', alignItems: 'center',
        background: '#0b1018', borderBottom: '1px solid rgba(255,255,255,0.05)',
        padding: '0 16px',
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, flex:1, minWidth:0 }}>
          {stage !== 'waiting' && (
            <div style={{ display:'flex', alignItems:'center', gap:5, flexShrink:0 }}>
              <div style={{ width:6, height:6, borderRadius:'50%', background:G, boxShadow:`0 0 6px ${G}` }}/>
              <span style={{ color:G, fontSize:10, fontWeight:700, letterSpacing:'0.14em' }}>LIVE</span>
            </div>
          )}
          {[
            { v: gameName,                                                 c:'#94a3b8' },
            { v: '·',                                                      c:'#1e3050' },
            { v: isUsdc && validGameId!=null ? `#${validGameId}` : 'NLH', c:'#334155', mono:true },
            { v: '·',                                                      c:'#1e3050' },
            { v: `STAKES ≡ ${cfg?.smallBlind||0}/${cfg?.bigBlind||0}`,    c:'#475569' },
            ...(isUsdc && potUsdc != null ? [{ v:'·', c:'#1e3050' }, { v:`≡ ${Number(potUsdc).toFixed(2)} USDC`, c:G }] : []),
            ...(actionPlayer ? [{ v:'·', c:'#1e3050' }, {
              v: (actionPlayer.address||'').toLowerCase()===me ? 'YOUR TURN ⏳' : `${(actionPlayer.address||'').slice(0,8)}… ⏳`,
              c: '#fbbf24',
            }] : []),
          ].map(({ v, c, mono }, i) => (
            <span key={i} style={{
              color: c, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
              fontFamily: mono ? 'Space Mono,monospace' : undefined,
              flexShrink: v==='·' ? 0 : 1,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{v}</span>
          ))}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
          {canManage && isHost && (
            <button
              onClick={() => { setStartError(null); startGame().catch(e => setStartError(e.message||'Error')); }}
              disabled={players.length < (cfg?.minPlayers ?? 2)}
              style={{
                padding:'5px 14px', borderRadius:6, fontSize:11, fontWeight:700, letterSpacing:'0.1em',
                background:`${G}18`, border:`1px solid ${G}40`, color:G, cursor:'pointer',
                opacity: players.length < (cfg?.minPlayers??2) ? 0.4 : 1,
              }}>START GAME</button>
          )}
          {canTerminate && isHost && (
            <button onClick={() => terminateGame().catch(console.error)} style={{
              padding:'5px 12px', borderRadius:6, fontSize:11, fontWeight:700,
              background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)',
              color:'#f87171', cursor:'pointer',
            }}>TERMINATE</button>
          )}
          {!isHost && canManage && (
            <span style={{ color:'#334155', fontSize:11 }}>Waiting for host…</span>
          )}
          <button onClick={() => leaveTable()} style={{
            padding:'5px 14px', borderRadius:6, fontSize:11, fontWeight:700, letterSpacing:'0.08em',
            background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.22)',
            color:'#f87171', cursor:'pointer',
          }}>⊗ LEAVE</button>
        </div>
      </div>

      {startError && (
        <div style={{ flexShrink:0, background:'rgba(245,158,11,0.1)', borderBottom:'1px solid rgba(245,158,11,0.3)', padding:'6px 20px', color:'#fbbf24', fontSize:12, textAlign:'center' }}>
          {startError}
        </div>
      )}

      {/* ── Main row ───────────────────────────────────────────────────────────── */}
      <div style={{ flex:1, display:'flex', overflow:'hidden', minHeight:0 }}>

        {/* ── Left: table + action bar ───────────────────────────────────────── */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minWidth:0 }}>

          {/* ── TABLE AREA — ref'd for ResizeObserver; all children at 1:1 scale ── */}
          <div
            ref={tableRef}
            style={{
              flex: 1, position: 'relative', overflow: 'hidden',
              margin: '10px 10px 6px 10px',
              borderRadius: 18,
              background: '#060a10',
              border: '1px solid rgba(255,255,255,0.05)',
              boxShadow: '0 0 60px rgba(0,0,0,0.5)',
            }}
          >
            {/* Deep shadow under felt */}
            <div style={{
              position:'absolute',
              left: cx - rx - 10, top: cy - ry - 10,
              width: (rx+10)*2,   height: (ry+10)*2,
              borderRadius: '50%',
              background: '#030608',
              boxShadow: '0 20px 80px rgba(0,0,0,0.9)',
              pointerEvents: 'none',
            }}/>

            {/* Ambient green glow */}
            <div style={{
              position:'absolute',
              left: cx - rx - 70, top: cy - ry - 70,
              width: (rx+70)*2,   height: (ry+70)*2,
              borderRadius: '50%',
              background: `radial-gradient(ellipse at center,rgba(0,230,118,0.10) 0%,transparent 65%)`,
              pointerEvents: 'none',
            }}/>

            {/* Felt with neon green border */}
            <div style={{
              position:'absolute',
              left: cx - rx, top: cy - ry,
              width: rx*2, height: ry*2,
              borderRadius: '50%',
              background: 'radial-gradient(ellipse at 44% 40%,#0e3d1e 0%,#071c0d 58%,#040e07 100%)',
              boxShadow: `0 0 0 2.5px ${G}, 0 0 0 7px rgba(0,230,118,0.12), 0 0 45px rgba(0,230,118,0.07)`,
              overflow: 'hidden',
              pointerEvents: 'none',
            }}>
              {/* Felt texture stripes */}
              <div style={{
                position:'absolute', inset:0,
                background:'repeating-linear-gradient(0deg,transparent,transparent 20px,rgba(255,255,255,0.009) 20px,rgba(255,255,255,0.009) 21px)',
              }}/>
              {/* Watermark */}
              <div style={{
                position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
                color:'#fff', opacity:0.025, fontWeight:900,
                fontSize: Math.max(24, rx * 0.13),
                letterSpacing:'0.22em', userSelect:'none', whiteSpace:'nowrap',
              }}>CRYPTO POKER</div>
            </div>

            {/* Community cards — only shown when game is running */}
            {stage !== 'waiting' && (
              <div style={{
                position:'absolute',
                left: cx, top: cy - ry * 0.14,
                transform: 'translate(-50%,-50%)',
                display:'flex', flexDirection:'column', alignItems:'center', gap:8,
                pointerEvents:'none',
              }}>
                <div style={{ display:'flex', gap:6 }}>
                  {[0,1,2,3,4].map(i => community[i] ? (
                    <div key={i}><Card card={community[i]} size="md"/></div>
                  ) : (
                    <div key={i} style={{
                      width:54, height:76, borderRadius:7,
                      border:'1px solid rgba(255,255,255,0.04)',
                      background:'rgba(0,0,0,0.18)',
                    }}/>
                  ))}
                </div>
                {streetLabel && (
                  <div style={{ color:`${G}70`, fontSize:10, fontWeight:700, letterSpacing:'0.22em' }}>
                    {streetLabel}
                  </div>
                )}
              </div>
            )}

            {/* Pot */}
            {pot > 0 && stage !== 'waiting' && (
              <div style={{
                position:'absolute',
                left: cx, top: cy + ry * 0.26,
                transform: 'translate(-50%,-50%)',
                textAlign: 'center', pointerEvents:'none',
              }}>
                <div style={{ color:'rgba(255,255,255,0.18)', fontSize:9, fontWeight:700, letterSpacing:'0.22em', marginBottom:2 }}>MAIN POT</div>
                <div style={{ color:G, fontWeight:900, fontSize:Math.max(20, rx*0.09), fontFamily:'Space Mono,monospace', textShadow:`0 0 20px ${G}55` }}>
                  ≡ {pot}
                </div>
              </div>
            )}

            {/* Waiting text */}
            {stage === 'waiting' && (
              <div style={{
                position:'absolute', left:cx, top:cy,
                transform:'translate(-50%,-50%)',
                textAlign:'center', pointerEvents:'none',
              }}>
                <div style={{ color:'rgba(255,255,255,0.1)', fontSize:12, fontWeight:700, letterSpacing:'0.24em' }}>
                  {canManage && !isHost ? 'WAITING FOR HOST…' : canManage && isHost ? 'PRESS START GAME' : 'WAITING FOR PLAYERS…'}
                </div>
              </div>
            )}

            {/* ── Player stations — each is one self-contained block at 1:1 px ── */}
            {players.map((player, i) => {
              const { ax, ay, cos, sin } = seatPos(i, players.length);
              const isMe = (player.address||'').toLowerCase() === me;
              const grad = avatarGrad(player.address);
              const init = initial(player.address);

              return (
                <div key={player.id || i}>

                  {/* Hole cards — float toward the felt center */}
                  {(player.cardCount > 0 || player.cards?.length > 0) && !player.folded && (
                    <div style={{
                      position: 'absolute',
                      left: ax + (-cos) * (AVATAR_R + 22),
                      top:  ay + (-sin) * (AVATAR_R + 22),
                      transform: 'translate(-50%,-50%)',
                      display: 'flex', gap: 3, zIndex: 19,
                      pointerEvents: 'none',
                    }}>
                      {player.cards?.length > 0
                        ? player.cards.map((c,ci) => <Card key={ci} card={c} size="sm"/>)
                        : [...Array(player.cardCount||2)].map((_,ci) => <Card key={ci} hidden size="sm"/>)
                      }
                    </div>
                  )}

                  {/* Avatar circle */}
                  <div style={{
                    position: 'absolute',
                    left: ax, top: ay,
                    transform: 'translate(-50%,-50%)',
                    width: AVATAR_SIZE, height: AVATAR_SIZE,
                    borderRadius: '50%',
                    background: grad,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, fontWeight: 900, color: '#fff',
                    textShadow: '0 1px 4px rgba(0,0,0,0.7)',
                    border: player.isAction
                      ? '3px solid #fbbf24'
                      : isMe ? `2.5px solid ${G}` : '2px solid rgba(255,255,255,0.1)',
                    boxShadow: player.isAction
                      ? '0 0 0 5px rgba(251,191,36,0.15), 0 0 30px rgba(251,191,36,0.5)'
                      : isMe
                        ? `0 0 0 4px rgba(0,230,118,0.1), 0 6px 20px rgba(0,0,0,0.8)`
                        : '0 6px 20px rgba(0,0,0,0.8)',
                    opacity: player.folded ? 0.35 : 1,
                    transition: 'box-shadow 0.3s, opacity 0.3s',
                    zIndex: 20,
                  }}>
                    {init}
                    {player.isDealer && (
                      <div style={{
                        position:'absolute', top:-5, right:-5,
                        width:16, height:16, borderRadius:'50%',
                        background:'#fff', border:'1.5px solid #999',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        fontSize:8, fontWeight:900, color:'#111',
                        boxShadow:'0 1px 4px rgba(0,0,0,0.6)',
                      }}>D</div>
                    )}
                    {player.allIn && !player.folded && (
                      <div style={{
                        position:'absolute', bottom:-10, left:'50%', transform:'translateX(-50%)',
                        background:'#dc2626', color:'#fff', fontSize:7, fontWeight:800,
                        padding:'1px 5px', borderRadius:3, whiteSpace:'nowrap', letterSpacing:'0.06em',
                      }}>ALL-IN</div>
                    )}
                  </div>

                  {/* Info label — always directly below avatar, centered on ax */}
                  <div style={{
                    position: 'absolute',
                    left: ax,
                    top: ay + AVATAR_R + 8,
                    transform: 'translateX(-50%)',
                    zIndex: 18,
                    pointerEvents: 'none',
                    textAlign: 'center',
                  }}>
                    <div style={{
                      display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                      padding: '4px 10px 5px',
                      borderRadius: 8,
                      background: isMe ? 'rgba(0,230,118,0.07)' : 'rgba(4,8,18,0.90)',
                      border: `1px solid ${isMe ? G+'28' : 'rgba(255,255,255,0.07)'}`,
                      backdropFilter: 'blur(8px)',
                      minWidth: 62,
                    }}>
                      <div style={{
                        fontSize: 9, fontWeight: 800,
                        color: isMe ? G : '#e2e8f0',
                        fontFamily: 'Space Mono,monospace',
                        letterSpacing: '0.05em',
                        maxWidth: 76, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {isMe ? 'YOU' : `${(player.address||'').slice(0,5)}…${(player.address||'').slice(-3)}`}
                      </div>
                      <div style={{ fontSize:11, fontWeight:700, color:'#fbbf24', fontFamily:'Space Mono,monospace' }}>
                        ≡ {player.chips}
                      </div>
                      {player.folded && (
                        <div style={{ fontSize:8, color:'#475569', fontWeight:800, letterSpacing:'0.1em' }}>FOLD</div>
                      )}
                      {!player.connected && (
                        <div style={{ fontSize:8, color:'#f59e0b', fontWeight:800, letterSpacing:'0.1em' }}>AWAY</div>
                      )}
                    </div>
                  </div>

                  {/* Bet chip — between avatar and center */}
                  {player.bet > 0 && (
                    <div style={{
                      position: 'absolute',
                      left: cx + (ax - cx) * 0.48,
                      top:  cy + (ay - cy) * 0.48,
                      transform: 'translate(-50%,-50%)',
                      zIndex: 16,
                    }}>
                      <div style={{
                        minWidth: 28, height: 28, borderRadius: 14, padding: '0 6px',
                        background: 'linear-gradient(135deg,#fbbf24,#f59e0b)',
                        border: '2px solid #92400e',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 8, fontWeight: 900, color: '#000',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.7)',
                        whiteSpace: 'nowrap',
                      }}>
                        {player.bet > 9999 ? `${(player.bet/1000).toFixed(0)}k` : player.bet}
                      </div>
                    </div>
                  )}

                </div>
              );
            })}
          </div>

          {/* ── Bottom action bar — 3-column layout matching the design ────────── */}
          <div style={{
            flexShrink: 0,
            margin: '0 10px 10px',
            background: '#0a0e18',
            borderRadius: 14,
            border: '1px solid rgba(255,255,255,0.06)',
            padding: '10px 12px',
            display: 'flex', alignItems: 'stretch', gap: 12,
            minHeight: 86,
          }}>

            {/* Col 1 — YOUR HAND (fixed 200px) */}
            <div style={{
              width: 200, flexShrink: 0,
              background: 'rgba(0,0,0,0.35)',
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.06)',
              display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px',
            }}>
              {myPlayer?.cards?.length > 0 ? (
                <>
                  <div style={{ display:'flex', gap:5, flexShrink:0 }}>
                    {myPlayer.cards.map((c,i) => <Card key={i} card={c} size="lg"/>)}
                  </div>
                  <div style={{ minWidth:0 }}>
                    <div style={{ color:'rgba(255,255,255,0.25)', fontSize:8, fontWeight:700, letterSpacing:'0.22em', marginBottom:4 }}>YOUR HAND</div>
                    <div style={{ color:G, fontWeight:800, fontSize:11, letterSpacing:'0.04em', lineHeight:1.35 }}>
                      {handName(myPlayer.cards)}
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ color:'rgba(255,255,255,0.1)', fontSize:10, fontWeight:700, letterSpacing:'0.18em', textAlign:'center', width:'100%' }}>
                  {stage === 'waiting' ? 'WAITING…' : 'YOUR HAND'}
                </div>
              )}
            </div>

            {/* Col 2 — Action buttons + presets (flex 1) */}
            <div style={{ flex:1, display:'flex', flexDirection:'column', gap:7, minWidth:0 }}>
              {showActions ? (
                <>
                  {/* Main action buttons */}
                  <div style={{ display:'flex', gap:8, flex:1 }}>
                    <button
                      onClick={() => playerAction('fold').catch(console.error)}
                      style={{
                        flex:1, borderRadius:9, fontWeight:800, fontSize:13, letterSpacing:'0.1em',
                        background:'rgba(239,68,68,0.10)', border:'1.5px solid rgba(239,68,68,0.32)',
                        color:'#f87171', cursor:'pointer', transition:'background 0.15s',
                      }}
                      onMouseEnter={e=>e.currentTarget.style.background='rgba(239,68,68,0.18)'}
                      onMouseLeave={e=>e.currentTarget.style.background='rgba(239,68,68,0.10)'}
                    >FOLD</button>

                    <button
                      onClick={() => playerAction(canCheck ? 'check' : 'call').catch(console.error)}
                      style={{
                        flex:1.3, borderRadius:9, fontWeight:800, fontSize:13, letterSpacing:'0.08em',
                        background:`rgba(0,230,118,0.08)`, border:`1.5px solid rgba(0,230,118,0.32)`,
                        color:G, cursor:'pointer', transition:'background 0.15s',
                      }}
                      onMouseEnter={e=>e.currentTarget.style.background=`rgba(0,230,118,0.16)`}
                      onMouseLeave={e=>e.currentTarget.style.background=`rgba(0,230,118,0.08)`}
                    >
                      {canCheck ? 'CHECK' : <span>CALL <span style={{fontFamily:'Space Mono,monospace'}}>≡ {callAmt}</span></span>}
                    </button>

                    <button
                      onClick={() => playerAction('raise', rVal).catch(console.error)}
                      style={{
                        flex:1.3, borderRadius:9, fontWeight:800, fontSize:13, letterSpacing:'0.08em',
                        background:'linear-gradient(135deg,rgba(29,78,216,0.72),rgba(0,180,216,0.72))',
                        border:'1.5px solid rgba(0,180,216,0.42)', color:'#fff',
                        cursor:'pointer', transition:'opacity 0.15s',
                      }}
                      onMouseEnter={e=>e.currentTarget.style.opacity='0.8'}
                      onMouseLeave={e=>e.currentTarget.style.opacity='1'}
                    >
                      RAISE <span style={{fontFamily:'Space Mono,monospace'}}>≡ {rVal}</span>
                    </button>
                  </div>

                  {/* Preset sizes */}
                  <div style={{ display:'flex', gap:5 }}>
                    {PRESETS.map(({ l, v }) => (
                      <button
                        key={l}
                        onClick={() => setRaiseAmt(String(Math.max(minRaise, Math.min(v, maxChips))))}
                        style={{
                          flex:1, padding:'3px 0', borderRadius:5,
                          fontSize:10, fontWeight:700, letterSpacing:'0.08em',
                          background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.07)',
                          color:'#475569', cursor:'pointer', transition:'color 0.12s, border-color 0.12s',
                        }}
                        onMouseEnter={e=>{e.currentTarget.style.color='#94a3b8';e.currentTarget.style.borderColor='rgba(255,255,255,0.14)';}}
                        onMouseLeave={e=>{e.currentTarget.style.color='#475569';e.currentTarget.style.borderColor='rgba(255,255,255,0.07)';}}
                      >{l}</button>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'rgba(255,255,255,0.08)', fontSize:11, fontWeight:700, letterSpacing:'0.2em' }}>
                  {stage !== 'waiting' ? 'WAITING FOR ACTION…' : ''}
                </div>
              )}
            </div>

            {/* Col 3 — Raise slider (fixed 170px, only visible when it's your turn) */}
            {showActions && (
              <div style={{ width:170, flexShrink:0, display:'flex', flexDirection:'column', justifyContent:'center', gap:8 }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <span style={{ color:'#334155', fontSize:9, fontWeight:700, letterSpacing:'0.14em' }}>RAISE SIZE</span>
                  <span style={{ color:G, fontFamily:'Space Mono,monospace', fontSize:12, fontWeight:700 }}>≡ {rVal}</span>
                </div>
                <input
                  type="range" min={minRaise} max={maxChips} value={rVal}
                  onChange={e => setRaiseAmt(e.target.value)}
                  style={{ width:'100%', accentColor:G, cursor:'pointer' }}
                />
                <div style={{ display:'flex', justifyContent:'space-between' }}>
                  <span style={{ color:'#1e3050', fontSize:9, fontFamily:'Space Mono,monospace' }}>≡{minRaise}</span>
                  <span style={{ color:'#1e3050', fontSize:9, fontFamily:'Space Mono,monospace' }}>≡{maxChips}</span>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* ── Right panel ────────────────────────────────────────────────────── */}
        <div style={{
          width: 258, flexShrink: 0, display: 'flex', flexDirection: 'column',
          borderLeft: '1px solid rgba(255,255,255,0.05)',
          background: '#0a0e16',
        }}>
          {/* Hand history */}
          <div style={{ padding:'14px 16px 10px', borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
              <span style={{ color:'#334155', fontSize:10, fontWeight:700, letterSpacing:'0.18em' }}>// HAND HISTORY</span>
              <span style={{ color:'#1e3050', fontSize:10 }}>last 6</span>
            </div>
            {handHistory.length === 0
              ? <div style={{ color:'#1e3050', fontSize:11, padding:'2px 0' }}>No hands played yet.</div>
              : handHistory.map((hh, i) => (
                <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr auto auto', gap:8, alignItems:'center', padding:'5px 0', borderBottom:'1px solid rgba(255,255,255,0.03)' }}>
                  <span style={{ color:'#334155', fontSize:10, fontFamily:'Space Mono,monospace' }}>#{hh.hand}</span>
                  <span style={{ color:'#475569', fontSize:10 }}>{hh.who}</span>
                  <span style={{ color: hh.win ? G : P, fontSize:10, fontFamily:'Space Mono,monospace', fontWeight:700 }}>
                    {hh.win?'+':'-'}≡{Math.abs(hh.amount)}
                  </span>
                </div>
              ))
            }
          </div>

          {/* Chat */}
          <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div style={{ padding:'10px 16px 6px', borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ color:'#334155', fontSize:10, fontWeight:700, letterSpacing:'0.18em' }}>// TABLE CHAT</span>
            </div>
            <div ref={chatRef} style={{ flex:1, overflowY:'auto', padding:'8px 14px', display:'flex', flexDirection:'column', gap:5 }}>
              {chatMessages.map((m,i) => (
                <div key={i} style={{ fontSize:11, lineHeight:1.5 }}>
                  {m.system
                    ? <span style={{ color:'#1e3050', fontFamily:'Space Mono,monospace', fontSize:10 }}>{m.text}</span>
                    : <><span style={{ color:G, fontWeight:700, fontSize:10, marginRight:5 }}>{m.from}:</span><span style={{ color:'#94a3b8' }}>{m.text}</span></>
                  }
                </div>
              ))}
            </div>
            <div style={{ padding:'8px 12px', borderTop:'1px solid rgba(255,255,255,0.04)', display:'flex', gap:6 }}>
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && chatInput.trim()) {
                    setChatMessages(m => [...m, { from: myAddress ? `${myAddress.slice(0,6)}…` : 'YOU', text: chatInput.trim() }]);
                    setChatInput('');
                  }
                }}
                placeholder="Type message…"
                style={{ flex:1, background:'#060d14', border:'1px solid rgba(255,255,255,0.07)', borderRadius:6, padding:'7px 10px', color:'#e2e8f0', fontSize:12, outline:'none' }}
              />
              <button
                onClick={() => {
                  if (!chatInput.trim()) return;
                  setChatMessages(m => [...m, { from: myAddress ? `${myAddress.slice(0,6)}…` : 'YOU', text: chatInput.trim() }]);
                  setChatInput('');
                }}
                style={{ width:32, height:32, borderRadius:6, background:`${G}18`, border:`1px solid ${G}30`, color:G, cursor:'pointer', fontSize:14, display:'flex', alignItems:'center', justifyContent:'center' }}
              >↑</button>
            </div>
          </div>
        </div>

      </div>

      {/* ── Hand result overlay ─────────────────────────────────────────────────── */}
      {handResult && (
        <div style={{ position:'fixed', inset:0, display:'flex', alignItems:'center', justifyContent:'center', zIndex:50, pointerEvents:'none' }}>
          <div className="fade-in" style={{
            borderRadius:16, padding:'24px 36px', textAlign:'center',
            background:'rgba(9,13,20,0.95)', border:`1px solid ${G}40`,
            boxShadow:`0 0 60px ${G}18`, backdropFilter:'blur(20px)',
          }}>
            <div style={{ color:G, fontSize:11, fontWeight:700, letterSpacing:'0.22em', marginBottom:14 }}>HAND COMPLETE</div>
            {Object.entries(handResult.results||{}).map(([addr, { won, hand }]) => (
              <div key={addr} style={{ marginBottom:8, display:'flex', alignItems:'center', gap:10, justifyContent:'center' }}>
                <span style={{ color:'#475569', fontSize:12, fontFamily:'Space Mono,monospace' }}>{addr.slice(0,10)}…</span>
                {won > 0 && <span style={{ color:G, fontWeight:700, fontSize:14 }}>+{won}</span>}
                {hand && <span style={{ color:'#a855f7', fontSize:11 }}>({hand.name})</span>}
                {Array.isArray(handResult?.holeCards?.[addr]) && handResult.holeCards[addr].length > 0 && (
                  <div style={{ display:'flex', gap:4 }}>
                    {handResult.holeCards[addr].map((c,ci) => <Card key={ci} card={c} size="sm"/>)}
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
