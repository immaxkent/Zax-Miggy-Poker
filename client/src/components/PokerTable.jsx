import { useState, useEffect } from 'react';
import { useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { useGame } from '../context/GameContext';
import { ZAX_MIGGY_VAULT_ADDRESS, ZAX_MIGGY_VAULT_ABI, USDC_DECIMALS } from '../utils/web3Config';

// Game logic: server/src/poker-engine.js (no external SDK). Client only renders server state. See POKER_ENGINE_AND_ISSUES.md.
const SUIT_COLORS = { s: '#e2e8f0', h: '#f87171', d: '#f87171', c: '#e2e8f0' };
const SUIT_SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RANK_DISPLAY = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };

function Card({ card, hidden, small }) {
  if (!card && !hidden) return null;
  const size = small ? 'w-8 h-12 text-xs' : 'w-14 h-20 text-sm';

  if (hidden || !card) {
    return (
      <div className={`${size} rounded-lg flex items-center justify-center relative overflow-hidden`}
        style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #0f2744 50%, #1e3a5f 100%)', border: '1px solid #2d5a9e', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
        <div style={{ width: '85%', height: '85%', border: '1px solid #2d5a9e', borderRadius: '4px',
          backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(45,90,158,0.2) 3px, rgba(45,90,158,0.2) 4px)' }} />
      </div>
    );
  }

  const color = SUIT_COLORS[card.suit];
  const rank  = RANK_DISPLAY[card.rank] || card.rank;

  return (
    <div className={`${size} rounded-lg relative overflow-hidden`}
      style={{ background: 'linear-gradient(145deg, #ffffff 0%, #f8f8f8 100%)', border: '1px solid #ddd',
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)', color }}>
      <div className="absolute top-0.5 left-1 font-bold leading-none" style={{ fontFamily: 'Georgia, serif', color }}>
        <div>{rank}</div>
        <div style={{ fontSize: small ? '8px' : '10px' }}>{SUIT_SYMBOLS[card.suit]}</div>
      </div>
      <div className="absolute inset-0 flex items-center justify-center"
        style={{ fontSize: small ? '18px' : '28px', color }}>
        {SUIT_SYMBOLS[card.suit]}
      </div>
      <div className="absolute bottom-0.5 right-1 font-bold leading-none rotate-180" style={{ fontFamily: 'Georgia, serif', color }}>
        <div>{rank}</div>
        <div style={{ fontSize: small ? '8px' : '10px' }}>{SUIT_SYMBOLS[card.suit]}</div>
      </div>
    </div>
  );
}

// Oval table felt
function TableFelt({ children }) {
  return (
    <div className="relative overflow-visible" style={{ width: '700px', height: '420px' }}>
      {/* Outer rail */}
      <div className="absolute inset-0 rounded-full"
        style={{ background: 'linear-gradient(145deg, #8B4513, #5D2E0C)', boxShadow: '0 0 0 6px #4a1a00, 0 20px 60px rgba(0,0,0,0.8)' }} />
      {/* Felt */}
      <div className="absolute inset-3 rounded-full flex items-center justify-center overflow-visible"
        style={{ background: 'radial-gradient(ellipse at center, #1a5c2a 0%, #0d3d1a 60%, #082d12 100%)',
          boxShadow: 'inset 0 4px 20px rgba(0,0,0,0.4)' }}>
        {/* Logo watermark */}
        <div className="absolute opacity-5 text-white font-bold text-6xl tracking-widest select-none pointer-events-none"
          style={{ fontFamily: 'Georgia, serif' }}>CRYPTO POKER</div>
        {children}
      </div>
    </div>
  );
}

// Chip stack display
function ChipStack({ amount, label }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="relative">
        {[...Array(Math.min(5, Math.ceil(amount / 50)))].map((_, i) => (
          <div key={i} className="absolute" style={{
            bottom: `${i * 3}px`, left: 0, right: 0,
            width: '28px', height: '8px', borderRadius: '50%',
            background: `hsl(${30 + i * 40}, 80%, 50%)`,
            border: '1px solid rgba(0,0,0,0.3)',
            boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
            zIndex: i,
          }} />
        ))}
        <div style={{ height: `${Math.min(5, Math.ceil(amount / 50)) * 3 + 8}px`, width: '28px' }} />
      </div>
      <div className="text-yellow-300 text-xs font-bold mt-1 bg-black bg-opacity-50 px-1.5 py-0.5 rounded"
        style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
        {amount}
      </div>
      {label && <div className="text-gray-400 text-xs">{label}</div>}
    </div>
  );
}

// ─── Seat layout: 8 positions at 360/8°, icon on table edge, panel outside ─────
const SEAT_COUNT = 8;
const DEG_PER_SEAT = 360 / SEAT_COUNT; // 45°
const TABLE_WIDTH_PX = 700;
const TABLE_HEIGHT_PX = 420;
const CENTER_PCT = 50;
const RIM_RADIUS_X_PCT = 48; // ellipse on table edge (slightly in so icon doesn’t clip)
const RIM_RADIUS_Y_PCT = 48;
const PANEL_HALF_DEPTH_PX = 50;
const PANEL_OFFSET_X_PCT = (PANEL_HALF_DEPTH_PX / TABLE_WIDTH_PX) * 100;
const PANEL_OFFSET_Y_PCT = (PANEL_HALF_DEPTH_PX / TABLE_HEIGHT_PX) * 100;

function seatAngleRad(seatIndex) {
  const deg = seatIndex * DEG_PER_SEAT;
  return ((90 + deg) * Math.PI) / 180;
}

function getSeatLayout(seatIndex) {
  const angle = seatAngleRad(seatIndex);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rimX = CENTER_PCT + RIM_RADIUS_X_PCT * cos;
  const rimY = CENTER_PCT + RIM_RADIUS_Y_PCT * sin;
  const panelX = CENTER_PCT + RIM_RADIUS_X_PCT * cos + PANEL_OFFSET_X_PCT * cos;
  const panelY = CENTER_PCT + RIM_RADIUS_Y_PCT * sin + PANEL_OFFSET_Y_PCT * sin;
  return {
    icon: { left: `${rimX}%`, top: `${rimY}%`, transform: 'translate(-50%, -50%)' },
    panel: { left: `${panelX}%`, top: `${panelY}%`, transform: 'translate(-50%, -50%)' },
    angle,
  };
}

function getSeatPositions(n) {
  const count = Math.min(Math.max(1, n), SEAT_COUNT);
  return Array.from({ length: count }, (_, i) => getSeatLayout(i));
}

const AVATAR_ICONS = ['🃏', '👤', '🎭', '🦊', '🐶', '🐱', '🦁', '🐯'];
function getAvatarIcon(address) {
  if (!address) return AVATAR_ICONS[0];
  const idx = parseInt(address.slice(2, 10), 16) % AVATAR_ICONS.length;
  return AVATAR_ICONS[idx];
}

function PlayerSeat({ player, position, myAddress, isAction, seatPosition }) {
  const isMe = (player?.address || '').toLowerCase() === (myAddress || '').toLowerCase();
  const icon = getAvatarIcon(player?.address);
  const layout = seatPosition ?? getSeatLayout(Math.min(position, SEAT_COUNT - 1));
  const avatarPos = layout.icon;
  const panelPos = layout.panel;

  return (
    <>
      {/* Icon on table edge; layer above table */}
      <div className="absolute z-20" style={avatarPos}>
        {player ? (
          <div className={`w-12 h-12 rounded-full flex items-center justify-center text-2xl
            ${player.folded ? 'opacity-40' : ''} ${player.allIn ? 'ring-2 ring-red-500' : ''} ${isAction ? 'ring-2 ring-yellow-400 shadow-lg' : ''}`}
            style={{ background: `hsl(${parseInt((player.address || '').slice(2, 4), 16) * 1.4}, 60%, 25%)`,
              border: '2px solid rgba(255,255,255,0.3)', boxShadow: '0 4px 12px rgba(0,0,0,0.4)' }}>
            {icon}
          </div>
        ) : (
          <div className="w-12 h-12 rounded-full border-2 border-dashed border-gray-600 flex items-center justify-center opacity-40">
            <span className="text-gray-500 text-xs">Empty</span>
          </div>
        )}
      </div>

      {/* Info panel: inner edge on table rim, extends outward */}
      {player && (
        <div className="absolute z-20" style={panelPos}>
          <div className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all duration-300 ${
            isMe ? 'bg-blue-900/70' : 'bg-black/60'
          }`} style={{ minWidth: '72px', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div className="text-xs text-gray-300 font-mono" style={{ maxWidth: '70px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {isMe ? 'You' : `${player.address.slice(0, 4)}...${player.address.slice(-3)}`}
            </div>
            <div className="text-yellow-300 text-xs font-bold">{player.chips}</div>
            {player.bet > 0 && <div className="text-green-300 text-xs">Bet: {player.bet}</div>}
            {player.cards && player.cards.length > 0 && (
              <div className="flex gap-0.5">
                {player.cards.map((card, i) => (
                  <Card key={i} card={card} small />
                ))}
              </div>
            )}
            {player.cardCount > 0 && !player.cards && (
              <div className="flex gap-0.5">
                {[...Array(player.cardCount)].map((_, i) => <Card key={i} hidden small />)}
              </div>
            )}
            <div className="flex gap-1 flex-wrap justify-center">
              {player.isDealer && <span className="bg-white text-black text-xs font-bold px-1 rounded">D</span>}
              {player.folded   && <span className="bg-gray-600 text-white text-xs px-1 rounded">Fold</span>}
              {player.allIn    && <span className="bg-red-600 text-white text-xs px-1 rounded">All-In</span>}
              {!player.connected && <span className="bg-yellow-700 text-white text-xs px-1 rounded">Away</span>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Action buttons
function ActionPanel({ gameState, myAddress, onAction }) {
  const [raiseAmount, setRaiseAmount] = useState('');
  const me = (myAddress || '').toLowerCase();
  const myPlayer = gameState?.players?.find(p => (p.address || '').toLowerCase() === me);
  const isMyTurn = myPlayer?.isAction;

  if (!isMyTurn || gameState.stage === 'waiting' || gameState.stage === 'showdown') return null;

  const callAmount = gameState.currentBet - (myPlayer?.bet || 0);
  const minRaise   = gameState.currentBet + gameState.config.bigBlind;
  const canCheck   = callAmount <= 0;

  return (
    <div className="flex gap-3 items-end justify-center">
      {/* Fold */}
      <button onClick={() => onAction('fold')}
        className="px-6 py-2.5 rounded-lg font-bold text-sm transition-all duration-200 hover:scale-105 active:scale-95"
        style={{ background: 'linear-gradient(135deg, #7f1d1d, #991b1b)', border: '1px solid #ef4444',
          color: '#fca5a5', boxShadow: '0 4px 12px rgba(239,68,68,0.3)' }}>
        Fold
      </button>

      {/* Check / Call */}
      {canCheck ? (
        <button onClick={() => onAction('check')}
          className="px-6 py-2.5 rounded-lg font-bold text-sm transition-all duration-200 hover:scale-105 active:scale-95"
          style={{ background: 'linear-gradient(135deg, #14532d, #166534)', border: '1px solid #22c55e',
            color: '#86efac', boxShadow: '0 4px 12px rgba(34,197,94,0.3)' }}>
          Check
        </button>
      ) : (
        <button onClick={() => onAction('call')}
          className="px-6 py-2.5 rounded-lg font-bold text-sm transition-all duration-200 hover:scale-105 active:scale-95"
          style={{ background: 'linear-gradient(135deg, #14532d, #166534)', border: '1px solid #22c55e',
            color: '#86efac', boxShadow: '0 4px 12px rgba(34,197,94,0.3)' }}>
          Call {callAmount}
        </button>
      )}

      {/* Raise */}
      <div className="flex flex-col gap-1">
        <div className="flex gap-1">
          <input type="number" min={minRaise} placeholder={`Min ${minRaise}`}
            value={raiseAmount} onChange={e => setRaiseAmount(e.target.value)}
            className="w-24 px-2 py-1.5 rounded-lg text-sm font-mono text-center"
            style={{ background: '#0f172a', border: '1px solid #4b5563', color: '#e2e8f0' }} />
          <button onClick={() => raiseAmount && onAction('raise', Number(raiseAmount))}
            className="px-4 py-2.5 rounded-lg font-bold text-sm transition-all duration-200 hover:scale-105 active:scale-95"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', border: '1px solid #8b5cf6',
              color: '#c4b5fd', boxShadow: '0 4px 12px rgba(124,58,237,0.3)' }}>
            Raise
          </button>
        </div>
        {/* Quick raise buttons */}
        <div className="flex gap-1">
          {[minRaise, minRaise * 2, minRaise * 3].map(v => (
            <button key={v} onClick={() => { setRaiseAmount(String(v)); }}
              className="flex-1 text-xs py-1 rounded text-purple-300 hover:text-purple-100 transition-colors"
              style={{ background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.3)' }}>
              {v}
            </button>
          ))}
          <button onClick={() => setRaiseAmount(String(myPlayer?.chips || 0))}
            className="flex-1 text-xs py-1 rounded text-red-300 hover:text-red-100 transition-colors"
            style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.3)' }}>
            All-in
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PokerTable({ myAddress }) {
  const { gameState, playerAction, leaveTable, startGame, terminateGame } = useGame();
  const [handResult, setHandResult] = useState(null);
  const { lastHand } = useGame();

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
    const totalPot = deposit * BigInt(count);
    return formatUnits(totalPot, USDC_DECIMALS);
  })();
  const potUsdcLabel = potUsdc != null
    ? Number(potUsdc).toLocaleString(undefined, { maximumFractionDigits: 2 })
    : null;

  useEffect(() => {
    if (lastHand) {
      setHandResult(lastHand);
      setTimeout(() => setHandResult(null), 5000);
    }
  }, [lastHand]);

  if (!gameState) return null;

  const { players, community, pot, stage, config: tableConfig } = gameState;

  const seatPositions = getSeatPositions(players.length);

  const actionPlayer = players.find(p => p.isAction);
  const isHost = (gameState.hostId || '').toLowerCase() === (myAddress || '').toLowerCase();
  const canManageTable = gameState.stage === 'waiting' && !!gameState.hostId;
  const canTerminate = gameState.stage === 'waiting' && !gameState.gameStarted;

  return (
    <div className="flex flex-col min-h-screen">
      {/* Fixed header: title + table details */}
      <header className="flex-shrink-0 flex flex-wrap gap-4 items-center justify-center py-4 px-4 border-b"
        style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.3)' }}>
        <span className="text-white font-bold text-lg">Poker Table</span>
        <span style={{ color: '#f59e0b', fontWeight: 600 }}>{tableConfig?.name || 'Table'}</span>
        <span className="text-gray-400 text-sm">Blinds: {tableConfig?.smallBlind}/{tableConfig?.bigBlind}</span>
        {isUsdcTable && (
          potUsdc != null ? (
            <span className="text-emerald-300 font-semibold text-sm px-3 py-1 rounded-lg"
              style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)' }}>
              🪙 Pot: ${potUsdcLabel}USDC
            </span>
          ) : !ZAX_MIGGY_VAULT_ADDRESS ? (
            <span className="text-amber-300 font-semibold text-sm px-3 py-1 rounded-lg"
              style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)' }}>
              Pot: set VITE_ZAX_MIGGY_VAULT_ADDRESS
            </span>
          ) : gameReadError ? (
            <span className="text-red-300 font-semibold text-sm px-3 py-1 rounded-lg"
              style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)' }}>
              Pot: error reading contract (check Base network)
            </span>
          ) : (
            <span className="text-gray-300 font-semibold text-sm px-3 py-1 rounded-lg"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}>
              Pot: {gameLoading ? 'loading…' : '—'}
            </span>
          )
        )}
        <span className="capitalize px-2 py-0.5 rounded text-sm" style={{
          background: stage === 'waiting' ? '#1e293b' : 'rgba(34,197,94,0.15)',
          color: stage === 'waiting' ? '#64748b' : '#4ade80',
          border: `1px solid ${stage === 'waiting' ? '#334155' : '#22c55e'}`,
        }}>{stage}</span>
        {actionPlayer && (
          <span style={{ color: '#fcd34d' }}>
            ⏳ {(actionPlayer.address || '').toLowerCase() === (myAddress || '').toLowerCase() ? 'Your turn!' : `${(actionPlayer.address || '').slice(0, 6)}...`}
          </span>
        )}
      </header>

      {/* Centered table area */}
      <div className="flex-1 flex items-center justify-center min-h-0 py-6 overflow-auto">
        <div className="relative overflow-visible" style={{ width: '700px', height: '420px' }}>
      <TableFelt>
        {/* Community cards */}
        <div className="absolute" style={{ top: '38%', left: '50%', transform: 'translate(-50%, -50%)' }}>
          <div className="flex gap-2 items-center">
            {[0,1,2,3,4].map(i => (
              <Card key={i} card={community[i]} hidden={!community[i]} />
            ))}
          </div>
        </div>

        {/* Pot */}
        {pot > 0 && (
          <div className="absolute" style={{ top: '62%', left: '50%', transform: 'translate(-50%, -50%)' }}>
            <div className="flex flex-col items-center gap-1">
              <div className="text-yellow-300 font-bold text-lg"
                style={{ textShadow: '0 0 12px rgba(251,191,36,0.8)' }}>
                💰 {pot}
              </div>
              <div className="text-gray-400 text-xs">Total Pot</div>
            </div>
          </div>
        )}
      </TableFelt>
      {/* Seat layer: icons on table edge, panels outside; same 700x420 so % aligns with table rim */}
      <div className="absolute inset-0 overflow-visible" style={{ zIndex: 10 }}>
        {players.map((player, i) => (
          <PlayerSeat key={player.id} player={player} position={i}
            myAddress={myAddress} isAction={player?.isAction}
            seatPosition={seatPositions[i]} />
        ))}
      </div>
        </div>
      </div>

      {/* Action panel + host controls + leave */}
      <div className="flex-shrink-0 flex flex-col items-center gap-3 pb-6">
        {canManageTable && (
          <div className="flex gap-3 items-center">
            {isHost && (
              <>
                <button onClick={() => startGame().catch(console.error)}
                  disabled={!gameState?.players?.length || gameState.players.length < (tableConfig?.minPlayers ?? 2)}
                  className="px-5 py-2.5 rounded-xl font-bold text-sm disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #15803d, #22c55e)', color: '#fff' }}>
                  Start game
                </button>
                {canTerminate && (
                  <button onClick={() => terminateGame().catch(console.error)}
                    className="px-5 py-2.5 rounded-xl font-bold text-sm"
                    style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid #ef4444', color: '#fca5a5' }}>
                    Terminate game
                  </button>
                )}
              </>
            )}
            {!isHost && (
              <p className="text-gray-400 text-sm">Waiting for host to start the game…</p>
            )}
          </div>
        )}
        <ActionPanel gameState={gameState} myAddress={myAddress}
          onAction={(action, amount) => playerAction(action, amount).catch(console.error)} />
        <button onClick={() => leaveTable()}
          className="text-sm text-gray-500 hover:text-gray-300 transition-colors underline underline-offset-2">
          {gameState?.tableId?.startsWith('usdc-') ? 'Leave table' : 'Leave table & cash out'}
        </button>
      </div>

      {/* Hand result overlay */}
      {handResult && (
        <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
          <div className="rounded-2xl p-6 text-center"
            style={{ background: 'rgba(0,0,0,0.85)', border: '1px solid rgba(251,191,36,0.4)',
              boxShadow: '0 0 40px rgba(251,191,36,0.2)', backdropFilter: 'blur(12px)' }}>
            <div className="text-yellow-300 text-2xl font-bold mb-3">Hand Complete</div>
            {Object.entries(handResult.results).map(([addr, { won, hand }]) => (
              <div key={addr} className="text-sm mb-1">
                <span className="text-gray-400">{addr.slice(0,8)}...</span>
                {won > 0 && <span className="text-green-400 font-bold ml-2">+{won} chips</span>}
                {hand && <span className="text-purple-300 ml-2">({hand.name})</span>}
                {Array.isArray(handResult?.holeCards?.[addr]) && handResult.holeCards[addr].length > 0 && (
                  <span className="ml-2 inline-flex gap-1 align-middle">
                    {handResult.holeCards[addr].map((card, i) => (
                      <Card key={`${addr}-${i}`} card={card} small />
                    ))}
                  </span>
                )}
              </div>
            ))}
            {handResult.verify && (
              <div className="mt-3 text-xs text-gray-500">
                Server seed: <span className="font-mono text-gray-400">{handResult.verify.serverSeed?.slice(0,12)}...</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
