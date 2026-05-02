import { useEffect, useState } from 'react';
import { useParams, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useReadContract, useAccount } from 'wagmi';
import { ZAX_MIGGY_VAULT_ADDRESS, ZAX_MIGGY_VAULT_ABI } from '../utils/web3Config';
import { useGame } from '../context/GameContext';
import PokerTable from './PokerTable';

// ─── Tiny helpers ────────────────────────────────────────────────────────────
function CenteredMsg({ children, isError }) {
  return (
    <div className="flex items-center justify-center py-32">
      <div className="text-center">
        <p className={isError ? 'text-red-400' : 'text-gray-400 animate-pulse'}>{children}</p>
        <a href="/lobby" className="text-blue-400 text-sm mt-4 block underline">← Back to lobby</a>
      </div>
    </div>
  );
}

// ─── Guard: verifies on-chain membership then joins socket table ──────────────
export default function GameRoute() {
  const { gameId: gameIdStr } = useParams();
  const gameId = parseInt(gameIdStr, 10);
  const navigate = useNavigate();
  const location = useLocation();
  const justCreated = location.state?.justCreated === true;
  const justJoined  = location.state?.justJoined  === true;
  const { address } = useAccount();
  const { connected, joinUsdcTable, leaveTable, gameState } = useGame();
  const [joinError, setJoinError] = useState(null);
  const [everHadState, setEverHadState] = useState(false);

  const vaultReady = !!ZAX_MIGGY_VAULT_ADDRESS && !isNaN(gameId);
  const addrLower = address?.toLowerCase();

  console.log('[GAMEROUTE] render — gameId:', gameId, 'connected:', connected, 'address:', addrLower, 'justCreated:', justCreated);

  // ── On-chain membership check ──────────────────────────────────────────────
  const { data: rawGameData, isLoading, error: readError, isFetchedAfterMount } = useReadContract({
    address: vaultReady ? ZAX_MIGGY_VAULT_ADDRESS : undefined,
    abi: ZAX_MIGGY_VAULT_ABI,
    functionName: 'getGame',
    args: vaultReady ? [BigInt(gameId)] : undefined,
  });

  const gameData = rawGameData == null ? null
    : Array.isArray(rawGameData) ? rawGameData
    : [rawGameData.players, rawGameData.playerCount, rawGameData.depositAmount,
       rawGameData.createdAt, rawGameData.finished, rawGameData.winner];

  const [players, , , , finished] = gameData || [];

  // If vault not configured (local dev), skip the on-chain check
  const isPlayer = !vaultReady || (
    Array.isArray(players) && !!addrLower &&
    players.some(p => p && String(p).toLowerCase() === addrLower)
  );

  const isAtThisTable = gameState?.tableId === `usdc-${gameId}`;

  // ── Join socket table once on-chain check passes ───────────────────────────
  useEffect(() => {
    console.log('[GAMEROUTE] joinEffect — connected:', connected, 'isAtThisTable:', isAtThisTable, 'isLoading:', isLoading, 'isPlayer:', isPlayer, 'vaultReady:', vaultReady, 'gameId:', gameId);
    if (!connected || isAtThisTable || isNaN(gameId)) {
      console.log('[GAMEROUTE] joinEffect — skipping (connected/isAtThisTable/gameId guard)');
      return;
    }
    if (vaultReady && (isLoading || (!isPlayer && !justJoined && isFetchedAfterMount))) {
      console.log('[GAMEROUTE] joinEffect — skipping (vault check: isLoading=' + isLoading + ' isPlayer=' + isPlayer + ' justJoined=' + justJoined + ' isFetchedAfterMount=' + isFetchedAfterMount + ')');
      return;
    }
    console.log('[GAMEROUTE] joinEffect — calling joinUsdcTable(' + gameId + ')');
    joinUsdcTable(gameId).then(state => {
      console.log('[GAMEROUTE] joinUsdcTable success — state:', state);
    }).catch(err => {
      console.error('[GAMEROUTE] joinUsdcTable error:', err.message);
      if (!err.message?.includes('Already at a table')) {
        setJoinError(err.message || 'Could not join table');
      }
    });
  }, [connected, isAtThisTable, isLoading, isPlayer, justJoined, vaultReady, gameId, joinUsdcTable]);

  // ── Clean up orphaned server state: at table socket but not on-chain ──────
  useEffect(() => {
    if (vaultReady && isFetchedAfterMount && !isPlayer && isAtThisTable) {
      console.warn('[GAMEROUTE] orphan cleanup — at socket table but not on-chain, calling leaveTable');
      leaveTable();
    }
  }, [vaultReady, isFetchedAfterMount, isPlayer, isAtThisTable, leaveTable]);

  // ── Navigate to /lobby when table ends (terminate, leave, game over) ───────
  useEffect(() => {
    if (gameState) setEverHadState(true);
  }, [gameState]);

  useEffect(() => {
    if (everHadState && !gameState) navigate('/lobby', { replace: true });
  }, [everHadState, gameState, navigate]);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (isNaN(gameId)) return <Navigate to="/lobby" replace />;

  if (vaultReady) {
    if (isLoading) { console.log('[GAMEROUTE] render — isLoading, showing verifying'); return <CenteredMsg>Verifying access…</CenteredMsg>; }
    if (readError) { console.error('[GAMEROUTE] readError:', readError); return <CenteredMsg isError>Could not verify game access — make sure you're on Base network.</CenteredMsg>; }
    if (gameData && !isPlayer && !justCreated && !justJoined && isFetchedAfterMount) { console.warn('[GAMEROUTE] not a player — redirecting to lobby. players:', players, 'addrLower:', addrLower); return <Navigate to="/lobby" replace />; }
    if (finished) { console.log('[GAMEROUTE] game finished'); return <CenteredMsg>Game #{gameId} has finished.</CenteredMsg>; }
  }

  if (joinError) return <CenteredMsg isError>{joinError}</CenteredMsg>;

  if (!isAtThisTable && !gameState) {
    return <CenteredMsg>{connected ? 'Connecting to table…' : 'Waiting for server connection…'}</CenteredMsg>;
  }

  return <PokerTable myAddress={addrLower} />;
}
