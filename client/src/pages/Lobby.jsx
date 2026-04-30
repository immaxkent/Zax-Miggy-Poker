import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount, useWriteContract, useReadContract, useReadContracts } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import {
  SERVER_URL, SERVER_API_KEY,
  TOKEN_ADDRESS, VAULT_ADDRESS, TOKEN_DECIMALS, TOKEN_SYMBOL,
  VAULT_ABI, ERC20_ABI, CHAIN_ID, ANVIL_RPC_URL,
  USDC_ADDRESS, USDC_DECIMALS, ZAX_MIGGY_VAULT_ADDRESS, ZAX_MIGGY_VAULT_ABI,
  isBaseWithUsdc,
} from '../utils/web3Config';
import { useGame } from '../context/GameContext';

const G = '#00e676';
const P = '#ff0070';

// ─── Deterministic 3-word game names ──────────────────────────────────────────
const W1 = ['neon','shadow','golden','midnight','burning','frozen','electric','crimson','iron','silver','dark','wild','silent','blazing','cosmic','phantom','thunder','velvet','toxic','broken'];
const W2 = ['wolf','ace','king','blade','storm','ghost','viper','falcon','shark','dragon','joker','dealer','crown','knight','arrow','flame','raven','tiger','cobra','baron'];
const W3 = ['rising','calling','hunting','stacking','running','crushing','folding','betting','holding','shoving','bluffing','raising','chasing','grinding','sweeping','dealing','winning','banking','staking','loading'];

export function gameIdToName(id) {
  const n = Number(id);
  const a = W1[n % W1.length];
  const b = W2[Math.floor(n / W1.length) % W2.length];
  const c = W3[Math.floor(n / (W1.length * W2.length)) % W3.length];
  return `${c} ${a} ${b}`;
}

const STAKE_CONFIGS = {
  'micro-1': { name: 'Micro',       blinds: '1/2',     color: G,        tag: 'NLH · 6-MAX' },
  'low-1':   { name: 'Low',         blinds: '5/10',    color: '#00b4d8', tag: 'NLH · 6-MAX' },
  'mid-1':   { name: 'Mid Stakes',  blinds: '25/50',   color: '#a855f7', tag: 'NLH · 6-MAX' },
  'high-1':  { name: 'High Roller', blinds: '100/200', color: '#f59e0b', tag: 'NLH · 6-MAX' },
};

const FILTER_TABS = ['ALL', 'NLH', 'PLO', 'HEADS-UP', '6-MAX', '9-MAX', 'MICRO', 'LOW', 'MID', 'HIGH'];

// ─── Active table row ──────────────────────────────────────────────────────────
function TableRow({ tableId, info, onJoin, disabled }) {
  const cfg = STAKE_CONFIGS[tableId] || {};
  const players = info?.players || 0;
  const maxSeats = info?.maxSeats || 6;
  const isActive = info?.stage && info.stage !== 'waiting';
  const isFull = players >= maxSeats;
  const isHot = players >= maxSeats - 1;

  return (
    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background 0.15s', cursor: 'pointer' }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      {/* Table name */}
      <td style={{ padding: '14px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: `${cfg.color}18`, border: `1px solid ${cfg.color}30`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%', background: cfg.color,
              boxShadow: isActive ? `0 0 6px ${cfg.color}` : 'none',
            }} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14, letterSpacing: '0.04em' }}>
                {cfg.name?.toUpperCase()}
              </span>
              {isHot && (
                <span style={{
                  fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', color: P,
                  background: `${P}18`, border: `1px solid ${P}40`,
                  padding: '2px 6px', borderRadius: 4,
                }}>HOT</span>
              )}
            </div>
            <div style={{ color: '#334155', fontSize: 11, marginTop: 2 }}>T-{tableId} · {cfg.tag}</div>
          </div>
        </div>
      </td>
      {/* Game */}
      <td style={{ padding: '14px 12px', color: '#00b4d8', fontSize: 12, fontWeight: 700 }}>NLH</td>
      {/* Stakes */}
      <td style={{ padding: '14px 12px', color: '#e2e8f0', fontWeight: 700, fontSize: 13, fontFamily: 'Space Mono, monospace' }}>
        {cfg.blinds}
      </td>
      {/* Buy-in */}
      <td style={{ padding: '14px 12px', color: '#94a3b8', fontSize: 12, fontFamily: 'Space Mono, monospace' }}>—</td>
      {/* Players */}
      <td style={{ padding: '14px 12px' }}>
        <span style={{
          color: isFull ? P : G, fontWeight: 700, fontSize: 13,
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <span style={{ opacity: 0.5, fontSize: 11 }}>👥</span>
          <span style={{ color: isFull ? P : '#e2e8f0' }}>{players}</span>
          <span style={{ color: '#334155' }}>/{maxSeats}</span>
        </span>
      </td>
      {/* Avg pot */}
      <td style={{ padding: '14px 12px', color: '#94a3b8', fontSize: 12, fontFamily: 'Space Mono, monospace' }}>—</td>
      {/* H/hr */}
      <td style={{ padding: '14px 12px', color: '#94a3b8', fontSize: 12 }}>—</td>
      {/* Action */}
      <td style={{ padding: '14px 20px' }}>
        <button onClick={() => !disabled && onJoin(tableId)} disabled={disabled}
          style={{
            background: isFull ? 'rgba(255,255,255,0.04)' : `${G}18`,
            border: `1px solid ${isFull ? 'rgba(255,255,255,0.1)' : `${G}40`}`,
            color: isFull ? '#475569' : G,
            fontSize: 12, fontWeight: 700, letterSpacing: '0.1em',
            padding: '7px 18px', borderRadius: 6, cursor: isFull ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap', transition: 'all 0.15s',
          }}>
          {isFull ? 'FULL' : 'JOIN ↗'}
        </button>
      </td>
    </tr>
  );
}

// ─── Modals (preserved logic, new visual style) ────────────────────────────────
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const contractsDeployed = () => {
  const t = (TOKEN_ADDRESS || '').toLowerCase();
  const v = (VAULT_ADDRESS || '').toLowerCase();
  return t && v && t !== ZERO_ADDRESS && v !== ZERO_ADDRESS;
};

function Modal({ onClose, title, accent = G, children }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 50, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)',
    }}>
      <div style={{
        width: '100%', maxWidth: 440, borderRadius: 16, padding: 28,
        background: '#0d1520', border: `1px solid ${accent}30`,
        boxShadow: `0 0 60px ${accent}15`,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: 17, letterSpacing: '0.04em' }}>{title}</div>
          <button onClick={onClose} style={{ color: '#475569', background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function InputField({ label, ...props }) {
  return (
    <div style={{ marginBottom: 16 }}>
      {label && <div style={{ color: '#475569', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', marginBottom: 8 }}>{label}</div>}
      <input {...props} style={{
        width: '100%', padding: '12px 16px', borderRadius: 8,
        background: '#060d14', border: '1px solid rgba(255,255,255,0.08)',
        color: '#e2e8f0', fontSize: 15, fontFamily: 'Space Mono, monospace',
        outline: 'none', ...props.style,
      }} />
    </div>
  );
}

function PrimaryBtn({ children, style, ...props }) {
  return (
    <button {...props} style={{
      width: '100%', padding: '13px', borderRadius: 8, border: 'none',
      background: `linear-gradient(135deg, ${G}, #00b4d8)`,
      color: '#000', fontSize: 13, fontWeight: 800, letterSpacing: '0.12em',
      cursor: 'pointer', transition: 'opacity 0.15s',
      ...style,
    }}>
      {children}
    </button>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ color: '#475569', fontSize: 12 }}>{label}</span>
      <span style={{ color: '#e2e8f0', fontWeight: 600, fontFamily: 'Space Mono, monospace', fontSize: 13 }}>{value}</span>
    </div>
  );
}

function DepositModal({ onClose, onDeposited }) {
  const { address, chainId } = useAccount();
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState('input');
  const [error, setError] = useState(null);
  const { writeContractAsync } = useWriteContract();
  const wrongNetwork = chainId != null && Number(chainId) !== CHAIN_ID;
  const deployed = contractsDeployed();

  const { data: allowance } = useReadContract({
    address: deployed ? TOKEN_ADDRESS : undefined,
    abi: ERC20_ABI, functionName: 'allowance',
    args: [address, VAULT_ADDRESS], watch: true,
  });
  const { data: tokenBalance } = useReadContract({
    address: deployed ? TOKEN_ADDRESS : undefined,
    abi: ERC20_ABI, functionName: 'balanceOf',
    args: [address], watch: true,
  });

  async function handleDeposit() {
    if (!amount || Number(amount) <= 0) return;
    setError(null);
    const gross = parseUnits(amount, TOKEN_DECIMALS);
    try {
      if (!allowance || allowance < gross) {
        setStep('approving');
        await writeContractAsync({ address: TOKEN_ADDRESS, abi: ERC20_ABI, functionName: 'approve', args: [VAULT_ADDRESS, gross] });
        await new Promise(r => setTimeout(r, 4000));
      }
      setStep('depositing');
      await writeContractAsync({ address: VAULT_ADDRESS, abi: VAULT_ABI, functionName: 'deposit', args: [gross] });
      await new Promise(r => setTimeout(r, 4000));
      const net = Math.floor(Number(amount) * 0.92);
      onDeposited(net);
      setStep('done');
    } catch (err) {
      const msg = err.shortMessage || err.message || '';
      setError(msg);
      setStep('input');
    }
  }

  const balance = tokenBalance ? Number(formatUnits(tokenBalance, TOKEN_DECIMALS)).toFixed(2) : '—';
  const netPreview = amount ? Math.floor(Number(amount) * 0.92).toLocaleString() : null;

  if (!deployed) {
    return (
      <Modal onClose={onClose} title="Buy Chips" accent={G}>
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ color: '#f87171', fontWeight: 700, marginBottom: 8, fontSize: 13 }}>Contracts not deployed</div>
          <div style={{ color: '#64748b', fontSize: 12, lineHeight: 1.6 }}>Deploy local contracts and set addresses in <code style={{ color: '#94a3b8' }}>client/.env</code></div>
        </div>
        <button onClick={onClose} style={{ width: '100%', padding: 12, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', cursor: 'pointer', fontWeight: 600 }}>Close</button>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} title="Buy Chips" accent={G}>
      {wrongNetwork && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: 12, marginBottom: 16, color: '#f87171', fontSize: 12 }}>
          Wrong network — switch to Anvil Local (Chain ID 31337)
        </div>
      )}
      <InfoRow label={`Your ${TOKEN_SYMBOL} balance`} value={`${balance} ${TOKEN_SYMBOL}`} />
      <div style={{ height: 16 }} />
      <InputField label={`AMOUNT (${TOKEN_SYMBOL})`} type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Enter amount" />
      {netPreview && (
        <div style={{ background: `${G}08`, border: `1px solid ${G}20`, borderRadius: 10, padding: 12, marginBottom: 16 }}>
          <InfoRow label="Gross amount" value={`${Number(amount).toLocaleString()} ${TOKEN_SYMBOL}`} />
          <InfoRow label="Buy-in fee (8%)" value={`-${Math.floor(Number(amount) * 0.08).toLocaleString()}`} />
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, fontWeight: 700 }}>
            <span style={{ color: '#94a3b8', fontSize: 12 }}>Chips credited</span>
            <span style={{ color: G, fontFamily: 'Space Mono, monospace', fontSize: 13 }}>{netPreview} chips</span>
          </div>
        </div>
      )}
      {error && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 12, padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 8 }}>{error}</div>}
      <PrimaryBtn onClick={handleDeposit} disabled={!amount || step !== 'input' || wrongNetwork}
        style={{ opacity: !amount || step !== 'input' || wrongNetwork ? 0.4 : 1 }}>
        {step === 'input' && `BUY ${netPreview ? `${netPreview} CHIPS` : 'CHIPS'}`}
        {step === 'approving' && '⏳ APPROVING...'}
        {step === 'depositing' && '⏳ DEPOSITING...'}
        {step === 'done' && '✅ CHIPS ADDED!'}
      </PrimaryBtn>
      <div style={{ color: '#334155', fontSize: 11, textAlign: 'center', marginTop: 12 }}>5% cashout fee applies when withdrawing</div>
    </Modal>
  );
}

const usdcVaultReady = () => USDC_ADDRESS && ZAX_MIGGY_VAULT_ADDRESS;

function CreateUsdcGameModal({ onClose, onCreated }) {
  const { address, chainId } = useAccount();
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState('input');
  const [error, setError] = useState(null);
  const [gameId, setGameId] = useState(null);
  const { writeContractAsync } = useWriteContract();
  const wrongNetwork = chainId != null && Number(chainId) !== CHAIN_ID;

  const { data: usdcAllowance } = useReadContract({
    address: usdcVaultReady() ? USDC_ADDRESS : undefined,
    abi: ERC20_ABI, functionName: 'allowance',
    args: [address, ZAX_MIGGY_VAULT_ADDRESS], watch: true,
  });
  const { data: usdcBalance } = useReadContract({
    address: usdcVaultReady() ? USDC_ADDRESS : undefined,
    abi: ERC20_ABI, functionName: 'balanceOf', args: [address], watch: true,
  });
  const { data: nextGameIdData, refetch: refetchNextGameId } = useReadContract({
    address: usdcVaultReady() ? ZAX_MIGGY_VAULT_ADDRESS : undefined,
    abi: ZAX_MIGGY_VAULT_ABI, functionName: 'nextGameId',
  });

  async function handleCreate() {
    if (!amount || Number(amount) <= 0) return;
    setError(null);
    const raw = parseUnits(amount, USDC_DECIMALS);
    try {
      if (!usdcAllowance || usdcAllowance < raw) {
        setStep('approving');
        await writeContractAsync({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: 'approve', args: [ZAX_MIGGY_VAULT_ADDRESS, raw] });
        await new Promise(r => setTimeout(r, 3000));
      }
      setStep('creating');
      await writeContractAsync({ address: ZAX_MIGGY_VAULT_ADDRESS, abi: ZAX_MIGGY_VAULT_ABI, functionName: 'createGame', args: [raw] });
      await new Promise(r => setTimeout(r, 4000));
      const res = await refetchNextGameId();
      const id = Number(res.data ?? 0) - 1;
      setGameId(id);
      onCreated?.(id);
      setStep('done');
    } catch (err) {
      setError(err.shortMessage || err.message || 'Transaction failed');
      setStep('input');
    }
  }

  const balance = usdcBalance != null ? formatUnits(usdcBalance, USDC_DECIMALS) : '—';

  return (
    <Modal onClose={onClose} title="Create USDC Table" accent="#00b4d8">
      <div style={{ color: '#475569', fontSize: 12, lineHeight: 1.6, marginBottom: 20 }}>
        Set the buy-in in USDC. You deposit this amount; others must match to join.
      </div>
      {wrongNetwork && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: 12, marginBottom: 16, color: '#f87171', fontSize: 12 }}>
          Switch to {CHAIN_ID === 8453 ? 'Base' : `Chain ID ${CHAIN_ID}`}
        </div>
      )}
      <InfoRow label="Your USDC" value={`${balance} USDC`} />
      <div style={{ height: 16 }} />
      {step !== 'done' ? (
        <>
          <InputField label="TABLE COST (USDC)" type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 5" />
          {error && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 12 }}>{error}</div>}
          <PrimaryBtn onClick={handleCreate} disabled={!amount || step !== 'input' || wrongNetwork}
            style={{ background: 'linear-gradient(135deg, #1d4ed8, #00b4d8)', opacity: !amount || step !== 'input' ? 0.4 : 1 }}>
            {step === 'input' && 'CREATE GAME'}
            {step === 'approving' && '⏳ APPROVING USDC...'}
            {step === 'creating' && '⏳ CREATING GAME...'}
          </PrimaryBtn>
        </>
      ) : (
        <div style={{ background: `${G}0d`, border: `1px solid ${G}30`, borderRadius: 12, padding: 20 }}>
          <div style={{ color: G, fontWeight: 800, marginBottom: 10, fontSize: 14 }}>✓ GAME CREATED</div>
          <InfoRow label="Game ID" value={String(gameId)} />
          <InfoRow label="Table cost" value={`${amount} USDC`} />
          <div style={{ color: '#475569', fontSize: 11, marginTop: 10, marginBottom: 16 }}>Share this Game ID so others can join.</div>
          <PrimaryBtn onClick={() => onCreated?.(gameId)}>🃏 GO TO TABLE</PrimaryBtn>
        </div>
      )}
    </Modal>
  );
}

function JoinUsdcGameModal({ onClose, onJoined, openGames = [] }) {
  const { address, chainId } = useAccount();
  const { connected } = useGame();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [step, setStep] = useState('input');
  const [error, setError] = useState(null);
  const { writeContractAsync } = useWriteContract();
  const wrongNetwork = chainId != null && Number(chainId) !== CHAIN_ID;

  // Resolve input: accept game ID number OR 3-word name
  const validGameId = useMemo(() => {
    const t = input.trim();
    if (!t) return null;
    // numeric?
    if (/^\d+$/.test(t)) {
      const n = parseInt(t, 10);
      return n >= 0 ? n : null;
    }
    // name lookup
    const match = openGames.find(g => g.name.toLowerCase() === t.toLowerCase());
    return match ? match.id : null;
  }, [input, openGames]);

  const gameId = validGameId;

  const { data: rawGameData, error: readError } = useReadContract({
    address: usdcVaultReady() && validGameId != null ? ZAX_MIGGY_VAULT_ADDRESS : undefined,
    abi: ZAX_MIGGY_VAULT_ABI, functionName: 'getGame',
    args: validGameId != null ? [BigInt(validGameId)] : undefined,
  });

  const gameData = (() => {
    if (rawGameData == null) return null;
    if (Array.isArray(rawGameData)) return rawGameData;
    if (typeof rawGameData === 'object') {
      const o = rawGameData;
      return [o.players, o.playerCount, o.depositAmount, o.createdAt, o.finished, o.winner];
    }
    return null;
  })();

  const [players, playerCount, depositAmount, , finished] = gameData || [];
  const depositAmountNum = depositAmount != null && typeof depositAmount === 'bigint'
    ? Number(formatUnits(depositAmount, USDC_DECIMALS)) : null;
  const count = playerCount != null ? Number(playerCount) : 0;
  const addrLower = address?.toLowerCase();
  const creatorAddress = Array.isArray(players) && players[0] ? String(players[0]).toLowerCase() : null;
  const isCreator = !!addrLower && creatorAddress === addrLower;
  const isAlreadyInGame = Array.isArray(players) && !!addrLower && players.some(p => p && String(p).toLowerCase() === addrLower);
  const canJoin = gameData && !finished && count < 8 && (depositAmount != null && depositAmount > 0n) && !isAlreadyInGame;

  const { data: usdcAllowance } = useReadContract({
    address: usdcVaultReady() ? USDC_ADDRESS : undefined,
    abi: ERC20_ABI, functionName: 'allowance',
    args: [address, ZAX_MIGGY_VAULT_ADDRESS], watch: true,
  });

  async function handleJoin() {
    if (validGameId == null || !depositAmount) return;
    setError(null);
    try {
      if (!usdcAllowance || usdcAllowance < depositAmount) {
        setStep('approving');
        await writeContractAsync({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: 'approve', args: [ZAX_MIGGY_VAULT_ADDRESS, depositAmount] });
        await new Promise(r => setTimeout(r, 3000));
      }
      setStep('joining');
      await writeContractAsync({ address: ZAX_MIGGY_VAULT_ADDRESS, abi: ZAX_MIGGY_VAULT_ABI, functionName: 'joinGame', args: [BigInt(validGameId)] });
      await new Promise(r => setTimeout(r, 4000));
      onJoined?.();
      navigate(`/game/${validGameId}`);
      onClose();
    } catch (err) {
      setError(err.shortMessage || err.message || 'Transaction failed');
      setStep('input');
    }
  }

  return (
    <Modal onClose={onClose} title="Join USDC Table" accent="#00b4d8">
      <div style={{ color: '#475569', fontSize: 12, lineHeight: 1.6, marginBottom: 20 }}>
        Enter a game ID <span style={{ color: '#334155' }}>(e.g. 2)</span> or 3-word name <span style={{ color: '#334155' }}>(e.g. rising neon wolf)</span> to join.
      </div>
      {wrongNetwork && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: 12, marginBottom: 16, color: '#f87171', fontSize: 12 }}>
          Switch to {CHAIN_ID === 8453 ? 'Base' : `Chain ID ${CHAIN_ID}`}
        </div>
      )}
      <InputField label="GAME ID OR NAME" value={input} onChange={e => setInput(e.target.value)} placeholder="e.g. 2 or rising neon wolf" />
      {input.trim() && validGameId === null && (
        <div style={{ color: '#f59e0b', fontSize: 11, marginBottom: 10, marginTop: -10 }}>No matching game found.</div>
      )}
      {validGameId !== null && !(/^\d+$/.test(input.trim())) && (
        <div style={{ color: G, fontSize: 11, marginBottom: 10, marginTop: -10 }}>✓ Resolved to game #{validGameId}</div>
      )}
      {validGameId != null && !gameData && !readError && (
        <div style={{ color: '#475569', fontSize: 12, marginBottom: 12 }}>Loading game details…</div>
      )}
      {validGameId != null && readError && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: 12, marginBottom: 16, color: '#f87171', fontSize: 12 }}>
          Couldn't load game. Switch to Base network and try again.
        </div>
      )}
      {depositAmountNum != null && depositAmountNum > 0 && (
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <InfoRow label="Table cost" value={`${depositAmountNum} USDC`} />
          <InfoRow label="Players" value={`${count}/8`} />
          {isCreator && <div style={{ color: G, fontSize: 11, marginTop: 10 }}>You created this game. Share ID <span style={{ fontFamily: 'monospace', color: '#fff' }}>{validGameId}</span></div>}
          {isAlreadyInGame && !isCreator && <div style={{ color: '#f59e0b', fontSize: 11, marginTop: 10 }}>You're already in this game.</div>}
          {finished && <div style={{ color: P, fontSize: 11, marginTop: 10 }}>This game is finished.</div>}
        </div>
      )}
      {error && (
        <div style={{ background: 'rgba(239,68,68,0.08)', borderRadius: 8, padding: 12, marginBottom: 16, color: '#f87171', fontSize: 12 }}>
          {error}
        </div>
      )}
      {(isCreator || isAlreadyInGame) && !finished && depositAmountNum > 0 && (
        <button onClick={() => { navigate(`/game/${validGameId}`); onClose(); }} disabled={!connected}
          style={{
            width: '100%', padding: 12, borderRadius: 8, marginBottom: 12,
            background: `${G}18`, border: `1px solid ${G}40`, color: G,
            fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: connected ? 1 : 0.5,
          }}>
          {connected ? '🃏 GO TO TABLE' : '⏳ CONNECTING...'}
        </button>
      )}
      <PrimaryBtn onClick={handleJoin} disabled={!canJoin || step !== 'input' || wrongNetwork}
        style={{ background: 'linear-gradient(135deg, #1d4ed8, #00b4d8)', opacity: !canJoin || step !== 'input' ? 0.4 : 1 }}>
        {step === 'input' && 'JOIN GAME'}
        {step === 'approving' && '⏳ APPROVING USDC...'}
        {step === 'joining' && '⏳ JOINING...'}
      </PrimaryBtn>
    </Modal>
  );
}

// ─── Ticker (mini) ─────────────────────────────────────────────────────────────
const TICKER_ITEMS = [
  '✦ HAND #842,193 — FLOPPED QUADS ON THE RIVER',
  '♦ TOURNEY: MIDNIGHT BOUNTY STARTS IN 02:14:33',
  '♥ PLAYER.ETH SCOOPED 12.4 ETH POT',
  '♠ NEW TABLE OPENED — BASE STREET NLH 0.1/0.25',
];

function Ticker() {
  const text = [...TICKER_ITEMS, ...TICKER_ITEMS].join('   ·   ');
  return (
    <div style={{ background: '#0d1520', borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '7px 0', overflow: 'hidden' }}>
      <div className="ticker-track" style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>
        <span style={{ color: '#334155', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', fontFamily: 'Space Mono, monospace' }}>{text}</span>
        <span style={{ color: '#334155', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', fontFamily: 'Space Mono, monospace' }}>{'   ·   ' + text}</span>
      </div>
    </div>
  );
}

// ─── Main Lobby ────────────────────────────────────────────────────────────────
export default function Lobby({ token, address }) {
  const { chips, joinTable, notifyDeposit } = useGame();
  const navigate = useNavigate();
  const [tables, setTables] = useState({});
  const [showDeposit, setShowDeposit] = useState(false);
  const [showCreateUsdc, setShowCreateUsdc] = useState(false);
  const [showJoinUsdc, setShowJoinUsdc] = useState(false);
  const [joinError, setJoinError] = useState(null);
  const [joining, setJoining] = useState(null);
  const [activeFilter, setActiveFilter] = useState('ALL');

  // ── On-chain USDC game list ──────────────────────────────────────────────────
  const { data: nextGameIdData } = useReadContract({
    address: usdcVaultReady() ? ZAX_MIGGY_VAULT_ADDRESS : undefined,
    abi: ZAX_MIGGY_VAULT_ABI,
    functionName: 'nextGameId',
    watch: true,
  });
  const nextGameId = nextGameIdData ? Number(nextGameIdData) : 0;
  const scanIds = useMemo(() => Array.from({ length: Math.min(nextGameId, 30) }, (_, i) => i), [nextGameId]);

  const { data: allGamesRaw } = useReadContracts({
    contracts: usdcVaultReady() ? scanIds.map(id => ({
      address: ZAX_MIGGY_VAULT_ADDRESS,
      abi: ZAX_MIGGY_VAULT_ABI,
      functionName: 'getGame',
      args: [BigInt(id)],
    })) : [],
    watch: true,
  });

  const openGames = useMemo(() => {
    if (!allGamesRaw) return [];
    return allGamesRaw.map((res, i) => {
      const raw = res?.result;
      if (!raw) return null;
      const arr = Array.isArray(raw) ? raw : [raw.players, raw.playerCount, raw.depositAmount, raw.createdAt, raw.finished, raw.winner];
      const [players, playerCount, depositAmount, , finished] = arr;
      const count = Number(playerCount || 0);
      if (count === 0 || finished) return null;
      return {
        id: i,
        name: gameIdToName(i),
        players: count,
        maxPlayers: 8,
        deposit: depositAmount ? Number(formatUnits(depositAmount, USDC_DECIMALS)) : 0,
        finished: !!finished,
        creator: Array.isArray(players) && players[0] ? String(players[0]) : null,
      };
    }).filter(Boolean).filter(g => !g.finished && g.players < 8);
  }, [allGamesRaw]);

  useEffect(() => {
    async function fetchTables() {
      try {
        const res = await fetch(`${SERVER_URL}/tables`, {
          headers: { 'X-Poker-Key': SERVER_API_KEY, 'Authorization': `Bearer ${token}` },
        });
        const list = await res.json();
        const map = {};
        list.forEach(t => { map[t.id] = t; });
        setTables(map);
      } catch (e) { console.error(e); }
    }
    fetchTables();
    const interval = setInterval(fetchTables, 8000);
    return () => clearInterval(interval);
  }, [token]);

  async function handleJoin(tableId) {
    setJoinError(null);
    setJoining(tableId);
    const minBuyIn = tableId.startsWith('micro') ? 40
      : tableId.startsWith('low')   ? 200
      : tableId.startsWith('mid')   ? 1000
      : 4000;
    if (chips < minBuyIn) {
      setJoinError(`Need at least ${minBuyIn} chips. Buy some first!`);
      setJoining(null);
      return;
    }
    try { await joinTable(tableId, minBuyIn); }
    catch (err) { setJoinError(err.message); }
    setJoining(null);
  }

  const usdcOnlyMode = isBaseWithUsdc();

  const totalPlayers = Object.values(tables).reduce((s, t) => s + (t.players || 0), 0);

  return (
    <div style={{ minHeight: 'calc(100vh - 60px)', background: '#090d14' }}>
      <Ticker />

      {/* Header */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 24px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 28 }}>
          <div>
            <div style={{ color: '#334155', fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', marginBottom: 8 }}>// LOBBY</div>
            <h1 style={{ color: '#fff', fontWeight: 900, fontSize: 32, letterSpacing: '0.04em', textTransform: 'uppercase', lineHeight: 1 }}>
              ACTIVE <span style={{ color: P }}>TABLES</span>
            </h1>
          </div>
          <div style={{ display: 'flex', gap: 24, color: '#475569', fontSize: 12, fontWeight: 700, letterSpacing: '0.1em' }}>
            <span>{Object.keys(tables).length || 4} <span style={{ color: '#334155' }}>TABLES</span></span>
            <span style={{ color: '#1e3050' }}>·</span>
            <span style={{ color: G }}>{totalPlayers || 0} <span style={{ color: '#334155' }}>PLAYERS</span></span>
            <span style={{ color: '#1e3050' }}>·</span>
            {usdcOnlyMode ? (
              <span style={{ color: '#f59e0b' }}>{chips || 0} <span style={{ color: '#334155' }}>CHIPS</span></span>
            ) : (
              <span>{chips.toLocaleString()} <span style={{ color: '#334155' }}>CHIPS</span></span>
            )}
          </div>
        </div>

        {/* Search + filters */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 0, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: '#0d1520', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8,
            padding: '9px 14px', flex: '0 0 220px',
          }}>
            <span style={{ color: '#334155', fontSize: 14 }}>⊙</span>
            <input placeholder="Search tables, stakes, players…"
              style={{ background: 'none', border: 'none', outline: 'none', color: '#e2e8f0', fontSize: 13, width: '100%' }} />
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {FILTER_TABS.map(tab => (
              <button key={tab} onClick={() => setActiveFilter(tab)} style={{
                padding: '8px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
                cursor: 'pointer', transition: 'all 0.15s',
                background: activeFilter === tab ? `${G}20` : 'rgba(255,255,255,0.03)',
                border: `1px solid ${activeFilter === tab ? `${G}50` : 'rgba(255,255,255,0.07)'}`,
                color: activeFilter === tab ? G : '#475569',
              }}>{tab}</button>
            ))}
          </div>
          {!usdcOnlyMode && (
            <button onClick={() => setShowDeposit(true)} style={{
              marginLeft: 'auto', padding: '9px 20px', borderRadius: 8,
              background: `${G}18`, border: `1px solid ${G}40`, color: G,
              fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', cursor: 'pointer',
            }}>+ BUY CHIPS</button>
          )}
        </div>
      </div>

      {/* Table list */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px' }}>
        {joinError && (
          <div style={{ margin: '16px 0', padding: '12px 16px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', fontSize: 13 }}>
            {joinError}
          </div>
        )}

        {!usdcOnlyMode && (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                {['TABLE', 'GAME', 'STAKES', 'BUY-IN', 'PLAYERS', 'AVG POT', 'H/HR', 'ACTION'].map(h => (
                  <th key={h} style={{
                    padding: '10px 20px', textAlign: 'left',
                    color: '#334155', fontSize: 10, fontWeight: 700, letterSpacing: '0.16em',
                    paddingLeft: h === 'TABLE' ? 20 : 12,
                    paddingRight: h === 'ACTION' ? 20 : 12,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(STAKE_CONFIGS).map(([tableId]) => (
                <TableRow key={tableId} tableId={tableId} info={tables[tableId]}
                  onJoin={handleJoin} disabled={!!joining} />
              ))}
            </tbody>
          </table>
        )}

        {/* USDC / User games section */}
        <div style={{ marginTop: usdcOnlyMode ? 32 : 48, paddingTop: usdcOnlyMode ? 0 : 32, borderTop: usdcOnlyMode ? 'none' : '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div>
              <div style={{ color: '#334155', fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', marginBottom: 6 }}>// ON-CHAIN · BASE</div>
              <h2 style={{ color: '#fff', fontWeight: 900, fontSize: 22, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                USER <span style={{ color: G }}>GAMES</span>
                {openGames.length > 0 && (
                  <span style={{ color: '#334155', fontSize: 13, fontWeight: 600, marginLeft: 12 }}>{openGames.length} OPEN</span>
                )}
              </h2>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowCreateUsdc(true)} style={{
                padding: '10px 22px', borderRadius: 8,
                background: 'linear-gradient(135deg, #1d4ed8, #00b4d8)',
                color: '#fff', fontSize: 12, fontWeight: 700, letterSpacing: '0.1em',
                cursor: 'pointer', border: 'none',
              }}>+ CREATE GAME</button>
              <button onClick={() => setShowJoinUsdc(true)} style={{
                padding: '10px 22px', borderRadius: 8,
                background: 'rgba(0,180,216,0.1)', border: '1px solid rgba(0,180,216,0.3)',
                color: '#00b4d8', fontSize: 12, fontWeight: 700, letterSpacing: '0.1em',
                cursor: 'pointer',
              }}>JOIN BY ID / NAME</button>
            </div>
          </div>

          {/* Open game cards */}
          {usdcVaultReady() && openGames.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {openGames.map(game => (
                <div key={game.id} style={{
                  background: '#0d1520', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14,
                  padding: 18, transition: 'all 0.2s', cursor: 'pointer',
                }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = `${G}40`; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'; e.currentTarget.style.transform = 'none'; }}
                  onClick={() => navigate(`/game/${game.id}`)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: G,
                      background: `${G}15`, border: `1px solid ${G}30`, padding: '2px 8px', borderRadius: 4,
                    }}>OPEN · {game.players}/8</div>
                    <div style={{ color: '#334155', fontSize: 10, fontFamily: 'Space Mono, monospace' }}>#{game.id}</div>
                  </div>
                  <div style={{ color: '#fff', fontWeight: 800, fontSize: 15, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 14 }}>
                    {game.name}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ color: '#334155', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', marginBottom: 3 }}>BUY-IN</div>
                      <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14, fontFamily: 'Space Mono, monospace' }}>{game.deposit} USDC</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: '#334155', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', marginBottom: 3 }}>HOST</div>
                      <div style={{ color: '#475569', fontSize: 11, fontFamily: 'Space Mono, monospace' }}>
                        {game.creator ? `${game.creator.slice(0,6)}…${game.creator.slice(-4)}` : '—'}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); navigate(`/game/${game.id}`); }}
                    style={{
                      width: '100%', marginTop: 14, padding: '9px', borderRadius: 7,
                      background: `${G}18`, border: `1px solid ${G}40`, color: G,
                      fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', cursor: 'pointer',
                    }}>
                    JOIN TABLE ↗
                  </button>
                </div>
              ))}
            </div>
          ) : usdcVaultReady() ? (
            <div style={{
              padding: '32px 24px', borderRadius: 12, textAlign: 'center',
              background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.07)',
            }}>
              <div style={{ color: '#334155', fontSize: 13, marginBottom: 8 }}>No open games right now.</div>
              <div style={{ color: '#1e3050', fontSize: 12 }}>Create one to get started.</div>
            </div>
          ) : (
            <div style={{ color: '#334155', fontSize: 12, padding: '16px 0' }}>
              Connect to Base mainnet to see and join USDC games.
            </div>
          )}
        </div>
      </div>

      {/* Tournaments section (visual) */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 24px 60px' }}>
        <div style={{ color: '#334155', fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', marginBottom: 8 }}>// TOURNAMENTS</div>
        <div style={{ color: '#fff', fontWeight: 900, fontSize: 20, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 24 }}>
          REGISTERING <span style={{ color: G }}>NOW</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {[
            { name: 'Midnight Bounty', prize: '50.0', buyIn: '0.25', badge: 'STARTING SOON', time: '02:14:33', badgeColor: G },
            { name: 'Blitz Hourly',    prize: '1.8',  buyIn: '0.01', badge: 'LIVE',          time: '00:23:11', badgeColor: G },
            { name: 'Whale Room',      prize: '220',  buyIn: '5.00', badge: 'REGISTERING',   time: 'FRI 21:00', badgeColor: '#f59e0b' },
            { name: 'Satoshi Sunday',  prize: '12.5', buyIn: '0.05', badge: 'REGISTERING',   time: 'SUN 20:00', badgeColor: P },
          ].map(({ name, prize, buyIn, badge, time, badgeColor }) => (
            <div key={name} style={{
              background: '#0d1520', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14,
              padding: 20, transition: 'border-color 0.2s',
            }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: badgeColor, background: `${badgeColor}18`, border: `1px solid ${badgeColor}30`, padding: '2px 8px', borderRadius: 4 }}>{badge}</div>
                <div style={{ color: '#475569', fontSize: 11, fontFamily: 'Space Mono, monospace' }}>{time}</div>
              </div>
              <div style={{ color: '#fff', fontWeight: 800, fontSize: 16, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 12 }}>{name}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ color: '#334155', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', marginBottom: 3 }}>PRIZE</div>
                  <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 13, fontFamily: 'Space Mono, monospace' }}>≡ {prize}</div>
                </div>
                <div>
                  <div style={{ color: '#334155', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', marginBottom: 3 }}>BUY-IN</div>
                  <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 13, fontFamily: 'Space Mono, monospace' }}>≡ {buyIn}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {showDeposit && <DepositModal onClose={() => setShowDeposit(false)} onDeposited={net => { notifyDeposit(net); setShowDeposit(false); }} />}
      {showCreateUsdc && <CreateUsdcGameModal onClose={() => setShowCreateUsdc(false)} onCreated={id => { navigate(`/game/${id}`, { state: { justCreated: true } }); setShowCreateUsdc(false); }} />}
      {showJoinUsdc && <JoinUsdcGameModal onClose={() => setShowJoinUsdc(false)} openGames={openGames} />}
    </div>
  );
}
