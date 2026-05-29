import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAccount, useWriteContract, useReadContract } from 'wagmi';
import { waitForTransactionReceipt } from '@wagmi/core';
import { decodeEventLog } from 'viem';
import {
  SERVER_URL,
  SERVER_API_KEY,
  USDC_ADDRESS,
  USDC_DECIMALS,
  ERC20_ABI,
  wagmiConfig,
} from '../utils/web3Config';
import {
  ARENA_ADDRESS,
  ARENA_ABI,
  ARENA_TIERS,
  AGENTIC_RANKINGS_V2_ADDRESS,
  RANKINGS_V2_ABI,
  isArenaConfigured,
  ZERO_SETTINGS_HASH,
} from '../utils/arenaConfig';
import { useGame } from '../context/GameContext';
import { gameIdToName } from './Lobby';

const G = '#00e676';
const P = '#ff0070';
const VIOLET = '#a855f7';

function Ticker() {
  return (
    <div style={{
      background: '#0d1520', borderBottom: '1px solid rgba(255,255,255,0.05)',
      padding: '7px 16px', color: '#475569', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em',
    }}>
      AGENTIC ARENA · TRAINING MODE · NO CASH PRIZES · USDC = PLATFORM FEES ONLY
    </div>
  );
}

export default function ArenaLobby({ token, address }) {
  const navigate = useNavigate();
  const { connected, joinArenaTable } = useGame();
  const { address: wallet } = useAccount();
  const addr = (address || wallet || '').toLowerCase();

  const [arenaStatus, setArenaStatus] = useState(null);
  const [openGames, setOpenGames] = useState([]);
  const [selectedTier, setSelectedTier] = useState('unranked');
  const [botAddress, setBotAddress] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [joinGameId, setJoinGameId] = useState('');

  const chainReady = isArenaConfigured();
  const tierMeta = ARENA_TIERS.find(t => t.key === selectedTier) || ARENA_TIERS[0];
  const tierId = tierMeta.id;
  const playBot = (botAddress || addr || '').toLowerCase();

  useEffect(() => {
    fetch(`${SERVER_URL}/api/arena/status`)
      .then(r => r.json())
      .then(setArenaStatus)
      .catch(() => setArenaStatus({ enabled: false }));
  }, []);

  const fetchOpen = useCallback(() => {
    const q = tierId != null ? `?tier=${tierId}` : '';
    fetch(`${SERVER_URL}/api/arena/games/open${q}`)
      .then(r => r.json())
      .then(data => setOpenGames(Array.isArray(data) ? data : []))
      .catch(() => setOpenGames([]));
  }, [tierId]);

  useEffect(() => {
    if (arenaStatus?.enabled) fetchOpen();
  }, [arenaStatus?.enabled, fetchOpen]);

  const { data: eliteOk } = useReadContract({
    address: AGENTIC_RANKINGS_V2_ADDRESS || undefined,
    abi: RANKINGS_V2_ABI,
    functionName: 'isEliteEligible',
    args: playBot ? [playBot] : undefined,
    query: { enabled: !!AGENTIC_RANKINGS_V2_ADDRESS && !!playBot && selectedTier === 'elite' },
  });

  const { data: tierFeeOnChain } = useReadContract({
    address: ARENA_ADDRESS || undefined,
    abi: ARENA_ABI,
    functionName: 'tierFee',
    args: [tierId],
    query: { enabled: !!ARENA_ADDRESS },
  });

  const { writeContractAsync } = useWriteContract();

  async function ensureUsdcAllowance(spender, amount) {
    const { readContract } = await import('@wagmi/core');
    const allowance = await readContract(wagmiConfig, {
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [addr, spender],
    });
    if (allowance >= amount) return;
    const hash = await writeContractAsync({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [spender, amount],
    });
    await waitForTransactionReceipt(wagmiConfig, { hash });
  }

  async function handleCreateGame() {
    setError(null);
    if (!connected || !addr) {
      setError('Connect wallet and sign in first.');
      return;
    }
    if (selectedTier === 'elite' && eliteOk === false) {
      setError('Elite tier requires top-100 rank on-chain.');
      return;
    }
    if (!playBot || playBot.length < 10) {
      setError('Enter your bot contract address, or use your wallet address for human play.');
      return;
    }

    setBusy('create');
    try {
      let gameId;

      if (chainReady) {
        const fee = tierFeeOnChain ?? tierMeta.feeRaw;
        await ensureUsdcAllowance(ARENA_ADDRESS, fee);
        const countBefore = await (async () => {
          const { readContract } = await import('@wagmi/core');
          return readContract(wagmiConfig, {
            address: ARENA_ADDRESS,
            abi: ARENA_ABI,
            functionName: 'gameCount',
          });
        })();

        const hash = await writeContractAsync({
          address: ARENA_ADDRESS,
          abi: ARENA_ABI,
          functionName: 'createGame',
          args: [
            { tier: tierId, settingsHash: ZERO_SETTINGS_HASH, maxPlayers: 8 },
            playBot,
          ],
        });
        const receipt = await waitForTransactionReceipt(wagmiConfig, { hash });
        let parsedId = null;
        for (const log of receipt.logs) {
          try {
            const ev = decodeEventLog({
              abi: ARENA_ABI,
              data: log.data,
              topics: log.topics,
            });
            if (ev.eventName === 'GameCreated') {
              parsedId = Number(ev.args.gameId);
              break;
            }
          } catch { /* not our event */ }
        }
        gameId = parsedId ?? Number(countBefore);
      } else {
        gameId = Date.now() % 1_000_000_000;
      }

      await joinArenaTable({
        gameId,
        tier: selectedTier,
        botAddress: playBot,
      });

      navigate(`/arena/game/${gameId}`, { state: { justJoined: true } });
    } catch (e) {
      setError(e.shortMessage || e.message || 'Create failed');
    } finally {
      setBusy(null);
    }
  }

  async function handleJoinOpen(row) {
    setError(null);
    const gameId = row.on_chain_game_id ?? row.table_id?.replace('arena-', '');
    if (!gameId) return;
    setBusy(`join-${gameId}`);
    try {
      if (chainReady && row.on_chain_game_id != null) {
        const fee = tierFeeOnChain ?? tierMeta.feeRaw;
        await ensureUsdcAllowance(ARENA_ADDRESS, fee);
        const joinHash = await writeContractAsync({
          address: ARENA_ADDRESS,
          abi: ARENA_ABI,
          functionName: 'joinGame',
          args: [BigInt(row.on_chain_game_id), playBot],
        });
        await waitForTransactionReceipt(wagmiConfig, { hash: joinHash });
      }
      await joinArenaTable({
        gameId: Number(gameId),
        tier: row.tier ?? tierId,
        botAddress: playBot,
      });
      navigate(`/arena/game/${gameId}`, { state: { justJoined: true } });
    } catch (e) {
      setError(e.shortMessage || e.message || 'Join failed');
    } finally {
      setBusy(null);
    }
  }

  async function handleJoinById() {
    const id = parseInt(joinGameId, 10);
    if (!Number.isFinite(id)) {
      setError('Enter a valid game ID');
      return;
    }
    await handleJoinOpen({
      on_chain_game_id: id,
      table_id: `arena-${id}`,
      tier: tierId,
    });
  }

  if (arenaStatus && !arenaStatus.enabled) {
    return (
      <div style={{ minHeight: 'calc(100vh - 60px)', background: '#090d14', padding: 48, textAlign: 'center' }}>
        <p style={{ color: '#94a3b8' }}>Agentic arena is not enabled on the server.</p>
        <Link to="/lobby" style={{ color: G }}>← Back to lobby</Link>
      </div>
    );
  }

  const feeDisplay = tierFeeOnChain != null
    ? `$${(Number(tierFeeOnChain) / 10 ** USDC_DECIMALS).toFixed(2)}`
    : tierMeta.feeLabel;

  return (
    <div style={{ minHeight: 'calc(100vh - 60px)', background: '#090d14' }}>
      <Ticker />
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px 64px' }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ color: '#334155', fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', marginBottom: 8 }}>
            // AGENTIC ARENA
          </div>
          <h1 style={{ color: '#fff', fontWeight: 900, fontSize: 28, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            TRAINING <span style={{ color: VIOLET }}>LOBBY</span>
          </h1>
          <p style={{ color: '#64748b', fontSize: 14, marginTop: 10, maxWidth: 520 }}>
            Platform fees only — no prize pool. 1000 training chips per game. Results saved to your bot profile.
          </p>
          {!chainReady && (
            <div style={{
              marginTop: 14, padding: '10px 14px', borderRadius: 8,
              background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: '#fbbf24', fontSize: 13,
            }}>
              Contracts not configured (VITE_ARENA_ADDRESS) — server-only training mode; on-chain fees skipped.
            </div>
          )}
          {chainReady && (
            <div style={{ marginTop: 10, fontSize: 11, color: '#475569', fontFamily: 'Space Mono, monospace' }}>
              Arena {ARENA_ADDRESS?.slice(0, 10)}… · DB {arenaStatus?.dbBackend}
            </div>
          )}
        </div>

        {error && (
          <div style={{
            marginBottom: 16, padding: '12px 16px', borderRadius: 8,
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {/* Tier selector */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ color: '#334155', fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', marginBottom: 10 }}>
            SELECT TIER
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {ARENA_TIERS.map(t => {
              const active = selectedTier === t.key;
              const locked = t.key === 'elite' && eliteOk === false;
              return (
                <button
                  key={t.key}
                  type="button"
                  disabled={locked}
                  onClick={() => setSelectedTier(t.key)}
                  style={{
                    padding: 16, borderRadius: 12, textAlign: 'left', cursor: locked ? 'not-allowed' : 'pointer',
                    background: active ? `${t.color}12` : '#0d1520',
                    border: `1px solid ${active ? t.color : 'rgba(255,255,255,0.07)'}`,
                    opacity: locked ? 0.45 : 1,
                  }}
                >
                  <div style={{ color: t.color, fontSize: 11, fontWeight: 800, letterSpacing: '0.12em' }}>{t.name.toUpperCase()}</div>
                  <div style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 800, margin: '6px 0' }}>{t.feeLabel}</div>
                  <div style={{ color: '#64748b', fontSize: 11 }}>{t.desc}</div>
                  {t.key === 'elite' && (
                    <div style={{ marginTop: 8, fontSize: 10, color: eliteOk ? G : P, fontWeight: 700 }}>
                      {eliteOk === undefined ? '…' : eliteOk ? '✓ ELIGIBLE' : '🔒 TOP 100 ONLY'}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 10, color: '#475569', fontSize: 12 }}>
            Entry fee: <span style={{ color: G, fontWeight: 700 }}>{feeDisplay}</span> USDC
            {chainReady ? ' (on-chain)' : ' (off-chain dev)'}
          </div>
        </div>

        {/* Bot address */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ color: '#64748b', fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', display: 'block', marginBottom: 8 }}>
            BOT ADDRESS (or wallet for human play)
          </label>
          <input
            value={botAddress}
            onChange={e => setBotAddress(e.target.value)}
            placeholder={addr ? `${addr.slice(0, 10)}… (default: your wallet)` : '0x…'}
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 8, boxSizing: 'border-box',
              background: '#0d1520', border: '1px solid rgba(255,255,255,0.08)', color: '#e2e8f0',
              fontFamily: 'Space Mono, monospace', fontSize: 13,
            }}
          />
          <div style={{ marginTop: 8, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link to="/bots" style={{ color: VIOLET, fontSize: 12, fontWeight: 600 }}>Create bot →</Link>
            {playBot && (
              <Link to={`/bots/${playBot}`} style={{ color: G, fontSize: 12, fontWeight: 600 }}>View profile →</Link>
            )}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 32, flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={!!busy || !connected}
            onClick={handleCreateGame}
            style={{
              padding: '12px 28px', borderRadius: 8, border: 'none', cursor: busy ? 'wait' : 'pointer',
              background: `linear-gradient(135deg, ${VIOLET}, #6366f1)`,
              color: '#fff', fontSize: 12, fontWeight: 800, letterSpacing: '0.1em',
            }}
          >
            {busy === 'create' ? 'CREATING…' : '+ CREATE ARENA GAME'}
          </button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={joinGameId}
              onChange={e => setJoinGameId(e.target.value)}
              placeholder="Game ID"
              style={{
                width: 120, padding: '10px 12px', borderRadius: 8,
                background: '#0d1520', border: '1px solid rgba(255,255,255,0.08)', color: '#e2e8f0',
                fontFamily: 'Space Mono, monospace', fontSize: 13,
              }}
            />
            <button
              type="button"
              disabled={!!busy || !connected}
              onClick={handleJoinById}
              style={{
                padding: '10px 18px', borderRadius: 8,
                background: `${G}18`, border: `1px solid ${G}40`, color: G,
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}
            >
              JOIN
            </button>
          </div>
        </div>

        {/* Open games */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h2 style={{ color: '#fff', fontWeight: 800, fontSize: 16, letterSpacing: '0.06em' }}>
              OPEN GAMES · {tierMeta.name.toUpperCase()}
            </h2>
            <button type="button" onClick={fetchOpen} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 11, cursor: 'pointer' }}>
              REFRESH
            </button>
          </div>
          {openGames.length === 0 ? (
            <p style={{ color: '#475569', fontSize: 13 }}>No open games in this tier — create one above.</p>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {openGames.map(g => {
                const gid = g.on_chain_game_id ?? g.table_id?.replace('arena-', '');
                return (
                  <div
                    key={g.id || g.table_id}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '14px 18px', borderRadius: 10,
                      background: '#0d1520', border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <div>
                      <div style={{ color: '#e2e8f0', fontWeight: 700 }}>
                        {gameIdToName(gid)} <span style={{ color: '#475569', fontWeight: 400 }}>#{gid}</span>
                      </div>
                      <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>
                        {g.playerCount ?? g.participant_count ?? '—'} players · {g.status}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => handleJoinOpen(g)}
                      style={{
                        padding: '8px 16px', borderRadius: 6,
                        background: `${G}18`, border: `1px solid ${G}40`, color: G,
                        fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      }}
                    >
                      JOIN
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ marginTop: 40, paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <Link to="/lobby" style={{ color: '#64748b', fontSize: 12 }}>← Legacy USDC tables</Link>
        </div>
      </div>
    </div>
  );
}
