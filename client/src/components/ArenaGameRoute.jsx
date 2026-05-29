import { useEffect, useState } from 'react';
import { useParams, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useGame } from '../context/GameContext';
import PokerTable from './PokerTable';

function CenteredMsg({ children, isError }) {
  return (
    <div className="flex items-center justify-center py-32">
      <div className="text-center">
        <p className={isError ? 'text-red-400' : 'text-gray-400 animate-pulse'}>{children}</p>
        <a href="/arena" className="text-blue-400 text-sm mt-4 block underline">← Back to arena lobby</a>
      </div>
    </div>
  );
}

export default function ArenaGameRoute() {
  const { gameId: gameIdStr } = useParams();
  const gameId = parseInt(gameIdStr, 10);
  const navigate = useNavigate();
  const location = useLocation();
  const justJoined = location.state?.justJoined === true;
  const { address } = useAccount();
  const { connected, joinArenaTable, gameState } = useGame();
  const [joinError, setJoinError] = useState(null);
  const [everHadState, setEverHadState] = useState(false);
  const tier = location.state?.tier ?? 'unranked';

  const addrLower = address?.toLowerCase();
  const tableId = `arena-${gameId}`;
  const isAtThisTable = gameState?.tableId === tableId;

  useEffect(() => {
    if (!connected || isAtThisTable || isNaN(gameId)) return;
    joinArenaTable({
      gameId,
      tier,
      botAddress: addrLower,
    })
      .then(() => setJoinError(null))
      .catch(err => {
        if (!err.message?.includes('Already at a table')) {
          setJoinError(err.message || 'Could not join arena table');
        }
      });
  }, [connected, isAtThisTable, gameId, tier, addrLower, joinArenaTable, justJoined]);

  useEffect(() => {
    if (gameState) setEverHadState(true);
  }, [gameState]);

  useEffect(() => {
    if (everHadState && !gameState) navigate('/arena', { replace: true });
  }, [everHadState, gameState, navigate]);

  if (isNaN(gameId)) return <Navigate to="/arena" replace />;
  if (joinError) return <CenteredMsg isError>{joinError}</CenteredMsg>;
  if (!isAtThisTable && !gameState) {
    return <CenteredMsg>{connected ? 'Connecting to arena table…' : 'Waiting for server…'}</CenteredMsg>;
  }

  return (
    <>
      <div style={{
        position: 'fixed', top: 64, left: '50%', transform: 'translateX(-50%)', zIndex: 90,
        padding: '6px 14px', borderRadius: 20, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
        background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.35)', color: '#c4b5fd',
      }}>
        AGENTIC ARENA · GAME #{gameId} · NO CASH PAYOUT
      </div>
      <PokerTable myAddress={addrLower} />
    </>
  );
}
