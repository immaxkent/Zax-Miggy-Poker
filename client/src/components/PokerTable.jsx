import { useState, useEffect, useRef } from 'react';
import { useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { useGame } from '../context/GameContext';
import { ZAX_MIGGY_VAULT_ADDRESS, ZAX_MIGGY_VAULT_ABI, USDC_DECIMALS } from '../utils/web3Config';
import { gameIdToName } from '../pages/Lobby';

const G = '#00e676';
const P = '#ff0070';

const SUIT_COLORS  = { s: '#1a2235', h: '#e53e3e', d: '#e53e3e', c: '#1a2235' };
const SUIT_SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RANK_DISPLAY = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };

// ─── Stage dimensions (internal coordinate space) ─────────────────────────────
// Everything is laid out in this space; the whole stage is then CSS-scaled to fit.
const SW = 920, SH = 620;     // stage width/height
const OX = 460, OY = 295;     // oval center
const OA = 320, OB = 182;     // oval semi-axes (x, y)
const AVATAR_R = 24;          // avatar circle radius px

// ─── Card ──────────────────────────────────────────────────────────────────────
function Card({ card, hidden, size = 'md' }) {
  const dims = { sm: [34, 48, 18, 9], md: [54, 76, 28, 11], lg: [72, 102, 38, 14] };
  const [w, h, iconFs, rankFs] = dims[size] || dims.md;

  if (!card && !hidden) return null;

  if (hidden || !card) {
    return (
      <div style={{
        width: w, height: h, borderRadius: 6, flexShrink: 0,
        background: 'linear-gradient(160deg, #1c0838 0%, #3b0a6e 50%, #1c0838 100%)',
        border: `1px solid ${P}55`,
        boxShadow: `0 4px 14px rgba(0,0,0,0.55), 0 0 10px ${P}18`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          width: '78%', height: '78%', borderRadius: 4,
          border: `1px solid ${P}35`,
          background: `repeating-linear-gradient(45deg, transparent, transparent 4px, ${P}12 4px, ${P}12 5px)`,
        }} />
      </div>
    );
  }

  const col  = SUIT_COLORS[card.suit];
  const rank = RANK_DISPLAY[card.rank] || card.rank;

  return (
    <div style={{
      width: w, height: h, borderRadius: 6, flexShrink: 0, position: 'relative', overflow: 'hidden',
      background: 'linear-gradient(160deg,#ffffff,#f2f2f2)',
      border: '1px solid #ddd', boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
      color: col,
    }}>
      <div style={{ position:'absolute', top: 3, left: 4, fontFamily:'Georgia,serif', fontWeight:900, lineHeight:1.05, color: col }}>
        <div style={{ fontSize: rankFs }}>{rank}</div>
        <div style={{ fontSize: rankFs * 0.75 }}>{SUIT_SYMBOLS[card.suit]}</div>
      </div>
      <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize: iconFs, color: col }}>
        {SUIT_SYMBOLS[card.suit]}
      </div>
      <div style={{ position:'absolute', bottom:3, right:4, fontFamily:'Georgia,serif', fontWeight:900, lineHeight:1.05, color: col, transform:'rotate(180deg)' }}>
        <div style={{ fontSize: rankFs }}>{rank}</div>
        <div style={{ fontSize: rankFs * 0.75 }}>{SUIT_SYMBOLS[card.suit]}</div>
      </div>
    </div>
  );
}

// ─── Seat position math ────────────────────────────────────────────────────────
function seatPos(idx, total) {
  const deg = 90 + (idx / total) * 360;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  // Avatar pushed outside the oval rim
  const push = 46;
  const ax = OX + (OA + push) * cos;
  const ay = OY + (OB + push) * sin;
  return { ax, ay, cos, sin };
}

// ─── Avatar gradients ──────────────────────────────────────────────────────────
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
const avatarGrad = a => GRADS[a ? parseInt(a.slice(2,6),16) % GRADS.length : 0];
const initial    = a => a ? a.slice(2,3).toUpperCase() : '?';

// ─── Player station ────────────────────────────────────────────────────────────
function PlayerStation({ player, idx, total, myAddress }) {
  const isMe = (player.address||'').toLowerCase() === (myAddress||'').toLowerCase();
  const { ax, ay, cos, sin } = seatPos(idx, total);
  const grad = avatarGrad(player.address);
  const init = initial(player.address);

  // Cards peek toward the oval center (inward direction)
  const cardOffX = -cos * 26;
  const cardOffY = -sin * 26;

  return (
    <>
      {/* Avatar + cards group */}
      <div style={{
        position: 'absolute',
        left: ax, top: ay,
        transform: 'translate(-50%,-50%)',
        zIndex: 20,
      }}>
        {/* Cards peeking toward center */}
        {(player.cardCount > 0 || (player.cards && player.cards.length > 0)) && !player.folded && (
          <div style={{
            position:'absolute',
            left: `calc(50% + ${cardOffX}px)`,
            top: `calc(50% + ${cardOffY}px)`,
            transform: 'translate(-50%,-50%)',
            display:'flex', gap:2, zIndex:19,
          }}>
            {player.cards && player.cards.length > 0
              ? player.cards.map((c,i) => <Card key={i} card={c} size="sm" />)
              : [...Array(player.cardCount||2)].map((_,i) => <Card key={i} hidden size="sm" />)
            }
          </div>
        )}

        <div style={{
          width: AVATAR_R*2, height: AVATAR_R*2, borderRadius: '50%',
          background: grad,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 17, fontWeight: 900, color: '#fff',
          textShadow: '0 1px 4px rgba(0,0,0,0.6)',
          border: player.isAction
            ? '3px solid #fbbf24'
            : isMe ? `2.5px solid ${G}` : '2px solid rgba(255,255,255,0.15)',
          boxShadow: player.isAction
            ? '0 0 0 5px rgba(251,191,36,0.18), 0 0 28px rgba(251,191,36,0.5)'
            : isMe
              ? `0 0 0 3px rgba(0,230,118,0.15), 0 4px 16px rgba(0,0,0,0.7)`
              : '0 4px 16px rgba(0,0,0,0.7)',
          opacity: player.folded ? 0.4 : 1,
          transition: 'box-shadow 0.3s, border-color 0.3s, opacity 0.3s',
          cursor: 'default',
          position: 'relative', zIndex: 21,
        }}>
          {init}
        </div>
        {/* Dealer button */}
        {player.isDealer && (
          <div style={{
            position:'absolute', top:-4, right:-4, zIndex:22,
            width:16, height:16, borderRadius:'50%',
            background:'#fff', border:'1.5px solid #aaa',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:8, fontWeight:900, color:'#111',
            boxShadow:'0 1px 4px rgba(0,0,0,0.5)',
          }}>D</div>
        )}
        {/* All-in badge */}
        {player.allIn && !player.folded && (
          <div style={{
            position:'absolute', bottom:-9, left:'50%', transform:'translateX(-50%)', zIndex:22,
            background:'#dc2626', color:'#fff', fontSize:7, fontWeight:800,
            padding:'1px 5px', borderRadius:3, whiteSpace:'nowrap', letterSpacing:'0.06em',
          }}>ALL-IN</div>
        )}
      </div>

      {/* Info label — always directly below the avatar */}
      <div style={{
        position: 'absolute',
        left: ax,
        top: ay + AVATAR_R + 7,
        transform: 'translateX(-50%)',
        zIndex: 18,
        textAlign: 'center',
        pointerEvents: 'none',
      }}>
        <div style={{
          display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 1,
          padding: '3px 9px 4px', borderRadius: 8,
          background: isMe ? 'rgba(0,230,118,0.08)' : 'rgba(4,8,16,0.88)',
          border: `1px solid ${isMe ? G+'30' : 'rgba(255,255,255,0.07)'}`,
          backdropFilter: 'blur(8px)',
          minWidth: 62,
        }}>
          <div style={{
            fontSize: 9, fontWeight: 800,
            color: isMe ? G : '#e2e8f0',
            fontFamily:'Space Mono,monospace', letterSpacing:'0.05em',
            maxWidth: 72, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
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

      {/* Bet chip — halfway between avatar and table center */}
      {player.bet > 0 && (
        <div style={{
          position: 'absolute',
          left: OX + (ax - OX) * 0.48,
          top:  OY + (ay - OY) * 0.48,
          transform: 'translate(-50%,-50%)',
          zIndex: 16,
        }}>
          <div style={{
            minWidth:28, height:28, borderRadius:14, padding:'0 6px',
            background:'linear-gradient(135deg,#fbbf24,#f59e0b)',
            border:'2px solid #92400e',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:7, fontWeight:900, color:'#000',
            boxShadow:'0 2px 8px rgba(0,0,0,0.6)',
            whiteSpace:'nowrap',
          }}>
            {player.bet>9999?`${(player.bet/1000).toFixed(0)}k`:player.bet}
          </div>
        </div>
      )}
    </>
  );
}

// ─── Oval table ────────────────────────────────────────────────────────────────
function OvalTable({ children }) {
  return (
    <>
      {/* Ambient glow */}
      <div style={{
        position:'absolute',
        left: OX - OA - 50, top: OY - OB - 50,
        width: (OA + 50)*2, height: (OB + 50)*2,
        borderRadius:'50%',
        background: `radial-gradient(ellipse at center, rgba(0,230,118,0.14) 0%, transparent 65%)`,
        pointerEvents:'none',
      }}/>
      {/* Dark shadow base */}
      <div style={{
        position:'absolute',
        left: OX - OA - 8, top: OY - OB - 8,
        width: (OA+8)*2, height: (OB+8)*2,
        borderRadius:'50%',
        background:'#040a0d',
        boxShadow:'0 30px 100px rgba(0,0,0,0.95)',
      }}/>
      {/* Felt with neon green border */}
      <div style={{
        position:'absolute',
        left: OX - OA, top: OY - OB,
        width: OA*2, height: OB*2,
        borderRadius:'50%',
        background:'radial-gradient(ellipse at 45% 38%, #0e3d1e 0%, #071c0d 55%, #040e07 100%)',
        boxShadow:`0 0 0 2px ${G}, 0 0 0 6px rgba(0,230,118,0.15), 0 0 40px rgba(0,230,118,0.1), inset 0 3px 24px rgba(0,0,0,0.5)`,
        overflow:'hidden',
      }}>
        {/* Subtle felt texture */}
        <div style={{
          position:'absolute', inset:0,
          background:'repeating-linear-gradient(0deg,transparent,transparent 18px,rgba(255,255,255,0.012) 18px,rgba(255,255,255,0.012) 19px)',
          pointerEvents:'none',
        }}/>
        {/* Watermark */}
        <div style={{
          position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
          color:'#fff', opacity:0.03, fontWeight:900, fontSize:48, letterSpacing:'0.24em',
          userSelect:'none', pointerEvents:'none', whiteSpace:'nowrap',
        }}>CRYPTO POKER</div>
      </div>
      {/* Children on top */}
      {children}
    </>
  );
}

// ─── Action panel ──────────────────────────────────────────────────────────────
function ActionPanel({ gameState, myAddress, onAction }) {
  const [raiseAmt, setRaiseAmt] = useState('');
  const me = (myAddress||'').toLowerCase();
  const myPlayer = gameState?.players?.find(p => (p.address||'').toLowerCase() === me);

  useEffect(() => { setRaiseAmt(''); }, [gameState?.currentBet]);

  if (!myPlayer?.isAction || ['waiting','showdown'].includes(gameState.stage)) return null;

  const callAmt  = Math.max(0, gameState.currentBet - (myPlayer.bet||0));
  const minRaise = gameState.currentBet + (gameState.config?.bigBlind||0);
  const maxChips = myPlayer.chips || 0;
  const canCheck = callAmt <= 0;
  const rVal = raiseAmt ? Math.min(Math.max(Number(raiseAmt), minRaise), maxChips) : minRaise;

  const btn = (label, onClick, style={}) => (
    <button onClick={onClick} style={{
      padding:'11px 22px', borderRadius:8, fontWeight:800, fontSize:12,
      letterSpacing:'0.1em', cursor:'pointer', border:'none',
      transition:'opacity 0.15s, transform 0.1s',
      ...style,
    }}
      onMouseEnter={e=>e.currentTarget.style.opacity='0.85'}
      onMouseLeave={e=>e.currentTarget.style.opacity='1'}
      onMouseDown={e=>e.currentTarget.style.transform='scale(0.97)'}
      onMouseUp={e=>e.currentTarget.style.transform='scale(1)'}
    >{label}</button>
  );

  const PRESETS = [
    { l:'MIN',    v: minRaise },
    { l:'1/2',    v: Math.round((gameState.pot||0)*0.5) },
    { l:'2/3',    v: Math.round((gameState.pot||0)*0.67) },
    { l:'POT',    v: gameState.pot||0 },
    { l:'ALL-IN', v: maxChips },
  ];

  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', justifyContent:'center' }}>
      {btn('FOLD', ()=>onAction('fold'), {
        background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)', color:'#f87171',
      })}

      {canCheck
        ? btn('CHECK', ()=>onAction('check'), { background:`${G}18`, border:`1px solid ${G}45`, color:G })
        : btn(`CALL  ≡ ${callAmt}`, ()=>onAction('call'), { background:`${G}18`, border:`1px solid ${G}45`, color:G })
      }

      {/* Raise block */}
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <input type="range" min={minRaise} max={maxChips} value={rVal}
          onChange={e=>setRaiseAmt(e.target.value)}
          style={{ width:110, accentColor:G, cursor:'pointer' }}/>
        <span style={{ color:'#e2e8f0', fontFamily:'Space Mono,monospace', fontSize:12, minWidth:38 }}>
          ≡ {rVal}
        </span>
        {btn(`RAISE  ≡ ${rVal}`, ()=>onAction('raise', rVal), {
          background:'linear-gradient(135deg,#1d4ed8,#00b4d8)', color:'#fff',
        })}
      </div>

      {/* Presets */}
      <div style={{ display:'flex', gap:4 }}>
        {PRESETS.map(({l,v})=>(
          <button key={l} onClick={()=>setRaiseAmt(String(Math.max(minRaise,Math.min(v,maxChips))))} style={{
            padding:'5px 9px', borderRadius:5, fontSize:10, fontWeight:700, letterSpacing:'0.08em',
            background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.07)',
            color:'#64748b', cursor:'pointer', transition:'color 0.15s, border-color 0.15s',
          }}
            onMouseEnter={e=>{e.currentTarget.style.color='#e2e8f0';e.currentTarget.style.borderColor='rgba(255,255,255,0.16)';}}
            onMouseLeave={e=>{e.currentTarget.style.color='#64748b';e.currentTarget.style.borderColor='rgba(255,255,255,0.07)';}}
          >{l}</button>
        ))}
      </div>
    </div>
  );
}

// ─── Hand name ─────────────────────────────────────────────────────────────────
function handName(cards) {
  if (!cards||cards.length<2||!cards[0]||!cards[1]) return 'HOLE CARDS';
  const [a,b] = cards;
  if (a.rank===b.rank) {
    const n={A:'POCKET ACES',K:'POCKET KINGS',Q:'POCKET QUEENS',J:'POCKET JACKS',T:'POCKET TENS'};
    return n[a.rank]||`POCKET ${a.rank}S`;
  }
  return `${RANK_DISPLAY[a.rank]||a.rank}${RANK_DISPLAY[b.rank]||b.rank} ${a.suit===b.suit?'SUITED':'OFFSUIT'}`;
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function PokerTable({ myAddress }) {
  const { gameState, playerAction, leaveTable, startGame, terminateGame, lastHand } = useGame();
  const [handHistory, setHandHistory] = useState([]);
  const [chatMessages, setChatMessages] = useState([
    { from:'DEALER', text:'Welcome to the table.', system:true },
  ]);
  const [chatInput, setChatInput]   = useState('');
  const [handResult, setHandResult] = useState(null);
  const [startError, setStartError] = useState(null);
  const [scale, setScale]           = useState(1);
  const stageWrapRef = useRef(null);
  const chatRef      = useRef(null);

  // ── Scale stage to fit available space ──────────────────────────────────────
  useEffect(() => {
    const el = stageWrapRef.current;
    if (!el) return;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      setScale(Math.min((width - 8) / SW, (height - 8) / SH, 1));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── On-chain data ────────────────────────────────────────────────────────────
  const tableId       = gameState?.tableId;
  const isUsdcTable   = typeof tableId==='string' && tableId.startsWith('usdc-');
  const gameIdNum     = isUsdcTable ? (parseInt(tableId.replace('usdc-',''),10)|0) : null;
  const validGameId   = gameIdNum!=null && gameIdNum>=0 ? gameIdNum : null;
  const vaultReady    = !!ZAX_MIGGY_VAULT_ADDRESS && validGameId!=null;

  const { data: rawGameData } = useReadContract({
    address: vaultReady ? ZAX_MIGGY_VAULT_ADDRESS : undefined,
    abi: ZAX_MIGGY_VAULT_ABI, functionName:'getGame',
    args: vaultReady ? [BigInt(validGameId)] : undefined,
  });

  const potUsdc = (() => {
    if (!rawGameData) return null;
    const arr = Array.isArray(rawGameData) ? rawGameData
      : (rawGameData?.playerCount!=null ? [rawGameData.players,rawGameData.playerCount,rawGameData.depositAmount,rawGameData.createdAt,rawGameData.finished,rawGameData.winner] : null);
    if (!arr) return null;
    const [, playerCount, depositAmount] = arr;
    if (!depositAmount||!playerCount) return null;
    const dep = typeof depositAmount==='bigint' ? depositAmount : BigInt(depositAmount);
    return formatUnits(dep * BigInt(Number(playerCount)), USDC_DECIMALS);
  })();

  // ── Hand history accumulator ─────────────────────────────────────────────────
  useEffect(() => {
    if (!lastHand) return;
    setHandResult(lastHand);
    setTimeout(()=>setHandResult(null), 5000);
    const winner = Object.entries(lastHand.results||{}).find(([,v])=>v.won>0);
    if (winner) {
      const [addr,{won,hand}] = winner;
      const isMe = addr.toLowerCase()===(myAddress||'').toLowerCase();
      setHandHistory(h=>[{
        hand: lastHand.handNumber||h.length+1,
        who: isMe?'you':`${addr.slice(0,6)}…`,
        amount: won, win:true, handName: hand?.name,
      }, ...h.slice(0,5)]);
      setChatMessages(m=>[...m,{
        from:'DEALER',
        text:`hand #${lastHand.handNumber||'—'} — ${hand?.name||'winner'} wins ${won}`,
        system:true,
      }]);
    }
  }, [lastHand]);

  useEffect(()=>{ if(gameState?.stage&&gameState.stage!=='waiting') setStartError(null); },[gameState?.stage]);
  useEffect(()=>{ if(chatRef.current) chatRef.current.scrollTop=chatRef.current.scrollHeight; },[chatMessages]);

  if (!gameState) return null;

  const { players, community, pot, stage, config: cfg } = gameState;
  const me          = (myAddress||'').toLowerCase();
  const myPlayer    = players.find(p=>(p.address||'').toLowerCase()===me);
  const actionPlayer= players.find(p=>p.isAction);
  const host        = (gameState.hostId||'').toLowerCase();
  const isHost      = !!me && host===me;
  const canManage   = stage==='waiting' && !!gameState.hostId;
  const canTerminate= stage==='waiting' && !gameState.gameStarted;

  const communityCount = community.filter(Boolean).length;
  const nextStreet = communityCount===0?'FLOP':communityCount===3?'TURN':communityCount===4?'RIVER':'SHOWDOWN';
  const streetLabel = stage!=='waiting'&&stage!=='showdown'
    ? `${stage.toUpperCase()} · WAITING FOR ${nextStreet}`
    : stage.toUpperCase();

  const gameName = isUsdcTable&&validGameId!=null ? gameIdToName(validGameId).toUpperCase() : (cfg?.name?.toUpperCase()||'TABLE');

  return (
    <div style={{
      height:'calc(100vh - 60px)', display:'flex', flexDirection:'column',
      background:'#090d14', overflow:'hidden', fontFamily:"'Space Grotesk','Outfit',sans-serif",
    }}>

      {/* ── Top info bar ── */}
      <div style={{
        flexShrink:0, display:'flex', alignItems:'center', gap:0,
        height:44, background:'#0c1219', borderBottom:'1px solid rgba(255,255,255,0.06)',
        padding:'0 16px', overflow:'hidden',
      }}>
        {/* Left: game info */}
        <div style={{ display:'flex', alignItems:'center', gap:12, flex:1, minWidth:0, overflow:'hidden' }}>
          {stage!=='waiting' && (
            <div style={{ display:'flex', alignItems:'center', gap:5, flexShrink:0 }}>
              <div style={{ width:6,height:6,borderRadius:'50%',background:G,boxShadow:`0 0 6px ${G}` }}/>
              <span style={{ color:G, fontSize:11, fontWeight:700, letterSpacing:'0.12em' }}>LIVE</span>
            </div>
          )}
          <div style={{ display:'flex', alignItems:'center', gap:8, minWidth:0, overflow:'hidden' }}>
            {[
              { v: gameName, c:'#94a3b8' },
              { v: '·', c:'#1e3050' },
              { v: isUsdcTable&&validGameId!=null ? `#${validGameId}` : 'NLH 6-MAX', c:'#334155', mono:true },
              { v: '·', c:'#1e3050' },
              { v: `STAKES ≡ ${cfg?.smallBlind||0}/${cfg?.bigBlind||0}`, c:'#475569' },
              ...(isUsdcTable&&potUsdc!=null ? [{ v:'·', c:'#1e3050' },{ v:`≡ ${Number(potUsdc).toFixed(2)} USDC`, c:G }] : []),
              ...(actionPlayer ? [{ v:'·', c:'#1e3050' },{ v:(actionPlayer.address||'').toLowerCase()===me?'YOUR TURN ⏳':`${(actionPlayer.address||'').slice(0,8)}… ⏳`, c:'#fbbf24' }] : []),
            ].map(({v,c,mono},i)=>(
              <span key={i} style={{ color:c, fontSize:11, fontWeight:700, letterSpacing:'0.1em', fontFamily:mono?'Space Mono,monospace':undefined, flexShrink: v==='·'?0:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{v}</span>
            ))}
          </div>
        </div>

        {/* Right: controls */}
        <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0, marginLeft:16 }}>
          {canManage && isHost && (
            <button onClick={()=>{ setStartError(null); startGame().catch(e=>setStartError(e.message||'Error')); }}
              disabled={players.length<(cfg?.minPlayers??2)}
              style={{
                padding:'5px 14px', borderRadius:6, fontSize:11, fontWeight:700, letterSpacing:'0.1em',
                background:`${G}18`, border:`1px solid ${G}40`, color:G, cursor:'pointer',
                opacity:players.length<(cfg?.minPlayers??2)?0.4:1,
              }}>START GAME</button>
          )}
          {canTerminate && isHost && (
            <button onClick={()=>terminateGame().catch(console.error)} style={{
              padding:'5px 12px', borderRadius:6, fontSize:11, fontWeight:700,
              background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)', color:'#f87171', cursor:'pointer',
            }}>TERMINATE</button>
          )}
          {!isHost && canManage && (
            <span style={{ color:'#334155', fontSize:11 }}>Waiting for host…</span>
          )}
          <button onClick={()=>leaveTable()} style={{
            padding:'6px 16px', borderRadius:6, fontSize:11, fontWeight:700, letterSpacing:'0.08em',
            background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.25)', color:'#f87171', cursor:'pointer',
          }}>⊗ LEAVE</button>
        </div>
      </div>

      {startError && (
        <div style={{ flexShrink:0, background:'rgba(245,158,11,0.1)', borderBottom:'1px solid rgba(245,158,11,0.3)', padding:'7px 20px', color:'#fbbf24', fontSize:12, textAlign:'center' }}>
          {startError}
        </div>
      )}

      {/* ── Main area ── */}
      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>

        {/* Table column */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minWidth:0 }}>

          {/* Stage wrapper — fills available space, stage is scaled inside */}
          <div ref={stageWrapRef} style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden', position:'relative', margin:'8px 10px', borderRadius:16, background:'#060a10', border:'1px solid rgba(255,255,255,0.04)' }}>
            <div style={{
              width: SW, height: SH,
              transform: `scale(${scale})`,
              transformOrigin:'center center',
              position:'relative',
              flexShrink: 0,
            }}>
              <OvalTable>
                {/* Community cards — centered on felt */}
                <div style={{
                  position:'absolute',
                  left: OX, top: OY - 20,
                  transform:'translate(-50%,-50%)',
                  display:'flex', flexDirection:'column', alignItems:'center', gap:10,
                }}>
                  <div style={{ display:'flex', gap:8 }}>
                    {[0,1,2,3,4].map(i=>(
                      community[i] ? (
                        <div key={i} style={{ transition:'transform 0.3s', transform:'scale(1)' }}>
                          <Card card={community[i]} size="md"/>
                        </div>
                      ) : stage !== 'waiting' ? (
                        <div key={i} style={{ width:54, height:76, borderRadius:6, border:'1px solid rgba(255,255,255,0.05)', background:'rgba(255,255,255,0.015)', transition:'transform 0.3s' }}/>
                      ) : null
                    ))}
                  </div>
                  {stage!=='waiting' && (
                    <div style={{ color:'#475569', fontSize:10, fontWeight:700, letterSpacing:'0.2em' }}>
                      {streetLabel}
                    </div>
                  )}
                </div>

                {/* Pot — below community cards */}
                {(pot>0 || (isUsdcTable&&potUsdc!=null)) && (
                  <div style={{
                    position:'absolute',
                    left:OX, top:OY + 56,
                    transform:'translate(-50%,-50%)',
                    textAlign:'center',
                  }}>
                    <div style={{ color:'#334155', fontSize:9, fontWeight:700, letterSpacing:'0.22em', marginBottom:3 }}>MAIN POT</div>
                    <div style={{ color:G, fontWeight:900, fontSize:24, fontFamily:'Space Mono,monospace', textShadow:`0 0 18px ${G}55` }}>
                      ≡ {pot||0}
                    </div>
                  </div>
                )}

                {/* Waiting overlay */}
                {stage==='waiting' && (
                  <div style={{
                    position:'absolute', left:OX, top:OY,
                    transform:'translate(-50%,-50%)',
                    textAlign:'center',
                  }}>
                    <div style={{ color:'#1e3050', fontSize:12, fontWeight:700, letterSpacing:'0.22em' }}>
                      {canManage&&!isHost?'WAITING FOR HOST…':canManage&&isHost?'PRESS START GAME':'WAITING FOR PLAYERS…'}
                    </div>
                  </div>
                )}
              </OvalTable>

              {/* Player stations — absolute within stage */}
              {players.map((player,i)=>(
                <PlayerStation key={player.id||i} player={player} idx={i} total={players.length} myAddress={myAddress} />
              ))}
            </div>
          </div>

          {/* Bottom action bar */}
          <div style={{
            flexShrink:0, borderTop:'1px solid rgba(255,255,255,0.05)',
            background:'#0a0e16', padding:'10px 16px 14px',
          }}>
            {myPlayer?.cards?.length>0 && (
              <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:12 }}>
                <div style={{
                  padding:'8px 14px', borderRadius:10,
                  background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.07)',
                  display:'flex', alignItems:'center', gap:12,
                }}>
                  <div style={{ display:'flex', gap:6 }}>
                    {myPlayer.cards.map((c,i)=><Card key={i} card={c} size="lg"/>)}
                  </div>
                  <div>
                    <div style={{ color:'#334155', fontSize:9, fontWeight:700, letterSpacing:'0.2em', marginBottom:4 }}>YOUR HAND</div>
                    <div style={{ color:G, fontWeight:800, fontSize:14, letterSpacing:'0.06em' }}>
                      {handName(myPlayer.cards)}
                    </div>
                  </div>
                </div>
              </div>
            )}
            <ActionPanel gameState={gameState} myAddress={myAddress}
              onAction={(a,v)=>playerAction(a,v).catch(console.error)}/>
          </div>
        </div>

        {/* Right panel */}
        <div style={{
          width:258, flexShrink:0, display:'flex', flexDirection:'column',
          borderLeft:'1px solid rgba(255,255,255,0.06)',
          background:'#0a0e16',
        }}>
          {/* Hand history */}
          <div style={{ padding:'14px 16px 10px', borderBottom:'1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
              <span style={{ color:'#475569', fontSize:10, fontWeight:700, letterSpacing:'0.18em' }}>// HAND HISTORY</span>
              <span style={{ color:'#1e3050', fontSize:10 }}>last 6</span>
            </div>
            {handHistory.length===0
              ? <div style={{ color:'#1e3050', fontSize:11, padding:'4px 0' }}>No hands played yet.</div>
              : handHistory.map((h,i)=>(
                <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr auto auto', gap:8, alignItems:'center', padding:'5px 0', borderBottom:'1px solid rgba(255,255,255,0.03)' }}>
                  <span style={{ color:'#334155', fontSize:10, fontFamily:'Space Mono,monospace' }}>#{h.hand}</span>
                  <span style={{ color:'#64748b', fontSize:10 }}>{h.who}</span>
                  <span style={{ color:h.win?G:P, fontSize:10, fontFamily:'Space Mono,monospace', fontWeight:700 }}>
                    {h.win?'+':'-'}≡{Math.abs(h.amount)}
                  </span>
                </div>
              ))
            }
          </div>

          {/* Chat */}
          <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div style={{ padding:'10px 16px 6px', borderBottom:'1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ color:'#475569', fontSize:10, fontWeight:700, letterSpacing:'0.18em' }}>// TABLE CHAT</span>
            </div>
            <div ref={chatRef} style={{ flex:1, overflowY:'auto', padding:'8px 14px', display:'flex', flexDirection:'column', gap:5 }}>
              {chatMessages.map((m,i)=>(
                <div key={i} style={{ fontSize:11, lineHeight:1.5 }}>
                  {m.system
                    ? <span style={{ color:'#1e3050', fontFamily:'Space Mono,monospace', fontSize:10 }}>{m.text}</span>
                    : <><span style={{ color:G, fontWeight:700, fontSize:10, marginRight:5 }}>{m.from}:</span><span style={{ color:'#94a3b8' }}>{m.text}</span></>
                  }
                </div>
              ))}
            </div>
            <div style={{ padding:'8px 12px', borderTop:'1px solid rgba(255,255,255,0.05)', display:'flex', gap:6 }}>
              <input value={chatInput} onChange={e=>setChatInput(e.target.value)}
                onKeyDown={e=>{
                  if(e.key==='Enter'&&chatInput.trim()){
                    setChatMessages(m=>[...m,{from:myAddress?`${myAddress.slice(0,6)}…`:'YOU',text:chatInput.trim()}]);
                    setChatInput('');
                  }
                }}
                placeholder="Type message…"
                style={{ flex:1,background:'#060d14',border:'1px solid rgba(255,255,255,0.07)',borderRadius:6,padding:'7px 10px',color:'#e2e8f0',fontSize:12,outline:'none' }}
              />
              <button onClick={()=>{
                if(!chatInput.trim()) return;
                setChatMessages(m=>[...m,{from:myAddress?`${myAddress.slice(0,6)}…`:'YOU',text:chatInput.trim()}]);
                setChatInput('');
              }} style={{
                width:32,height:32,borderRadius:6,background:`${G}18`,border:`1px solid ${G}30`,
                color:G,cursor:'pointer',fontSize:14,display:'flex',alignItems:'center',justifyContent:'center',
              }}>↑</button>
            </div>
          </div>
        </div>
      </div>

      {/* Hand result overlay */}
      {handResult && (
        <div style={{ position:'fixed',inset:0,display:'flex',alignItems:'center',justifyContent:'center',zIndex:50,pointerEvents:'none' }}>
          <div className="fade-in" style={{
            borderRadius:16, padding:'24px 36px', textAlign:'center',
            background:'rgba(9,13,20,0.93)', border:`1px solid ${G}40`,
            boxShadow:`0 0 50px ${G}20`, backdropFilter:'blur(20px)',
          }}>
            <div style={{ color:G, fontSize:11, fontWeight:700, letterSpacing:'0.22em', marginBottom:14 }}>HAND COMPLETE</div>
            {Object.entries(handResult.results||{}).map(([addr,{won,hand}])=>(
              <div key={addr} style={{ marginBottom:8, display:'flex', alignItems:'center', gap:10, justifyContent:'center' }}>
                <span style={{ color:'#64748b', fontSize:12, fontFamily:'Space Mono,monospace' }}>{addr.slice(0,10)}…</span>
                {won>0 && <span style={{ color:G, fontWeight:700, fontSize:14 }}>+{won}</span>}
                {hand && <span style={{ color:'#a855f7', fontSize:11 }}>({hand.name})</span>}
                {Array.isArray(handResult?.holeCards?.[addr])&&handResult.holeCards[addr].length>0&&(
                  <div style={{ display:'flex', gap:4 }}>
                    {handResult.holeCards[addr].map((c,i)=><Card key={i} card={c} size="sm"/>)}
                  </div>
                )}
              </div>
            ))}
            {handResult.verify&&(
              <div style={{ color:'#1e3050', fontSize:10, marginTop:10, fontFamily:'Space Mono,monospace' }}>
                seed: {handResult.verify.serverSeed?.slice(0,16)}…
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
