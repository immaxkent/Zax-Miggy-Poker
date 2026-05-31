import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { SERVER_URL, SOCKET_URL, SERVER_API_KEY } from '../utils/web3Config';

const GameContext = createContext(null);

export function GameProvider({ children, authToken, walletAddress }) {
  const socketRef     = useRef(null);
  const [connected,   setConnected]   = useState(false);
  const [gameState,   setGameState]   = useState(null);
  const [chips,       setChips]       = useState(0);
  const [notification,setNotification]= useState(null);
  const [lastHand,    setLastHand]    = useState(null);
  const [victory,     setVictory]     = useState(null);
  const [actionTimer, setActionTimer] = useState(null);
  const [nextHandCountdown, setNextHandCountdown] = useState(null);
  const [tables,      setTables]      = useState([]);
  const [error,       setError]       = useState(null);
  const [chatLog,     setChatLog]     = useState([{ from: 'DEALER', text: 'Welcome to the table.', system: true }]);

  // ── Connect when authToken is available ────────────────────────────────────
  useEffect(() => {
    if (!authToken || !walletAddress) return;

    const socket = io(SOCKET_URL, {
      auth:      { token: authToken, apiKey: SERVER_API_KEY },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
    });

    function refreshState(s) {
      s.emit('getState', {}, (res) => {
        if (res?.state) setGameState(res.state);
      });
    }

    socket.on('connect', () => {
      setConnected(true);
      setError(null);
      // If server still has us at a table (e.g. after refresh), restore view
      socket.emit('getState', {}, (res) => {
        if (res?.state) setGameState(res.state);
      });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (err) => {
      console.error('Socket error:', err.message);
      const msg = err.message || '';
      const isWs = /websocket|ws|socket/i.test(msg);
      setError(isWs
        ? 'Game server unreachable. If you use ngrok, ensure the tunnel is running and VITE_SOCKET_URL matches your current ngrok URL, then redeploy.'
        : msg);
      setConnected(false);
    });

    socket.on('gameState',   (state) => {
      const who = state?.players?.find(p => p.isAction);
      if (process.env.NODE_ENV !== 'production') {
        console.log('[gameState]', state?.stage, 'turn:', who ? `${who.address?.slice(0, 8)}...` : '-');
      }
      setGameState(state);
    });
    socket.on('handStarted', (info)  => {
      setNotification({ type: 'hand', message: `Hand #${info.handNumber} starting!` });
      setTimeout(() => setNotification(null), 3000);
      // Self-heal if personalized gameState was missed (room broadcast / timing)
      refreshState(socket);
    });
    socket.on('handComplete', (result) => setLastHand(result));
    socket.on('chipsUpdated', ({ chips }) => setChips(chips));
    socket.on('actionTimer', (payload) => setActionTimer(payload || null));
    socket.on('nextHandCountdown', (payload) => setNextHandCountdown(payload || null));
    socket.on('winNotification', ({ amount }) => {
      setNotification({ type: 'win', message: `You won ${amount} chips! 🎉` });
      setTimeout(() => setNotification(null), 4000);
    });
    socket.on('playerJoined',   () => refreshState(socket));
    socket.on('playerLeft',     () => refreshState(socket));
    socket.on('tableTerminated', () => {
      setGameState(null);
      setNotification(null);
      setActionTimer(null);
      setNextHandCountdown(null);
    });
    socket.on('gameOver', ({ winner, gameId, summary, mode }) => {
      const isWinner = (winner || '').toLowerCase() === (walletAddress || '').toLowerCase();
      const isArena = mode === 'arena';
      setNotification({
        type: isWinner ? 'win' : 'lose',
        message: isArena
          ? (isWinner ? '🏆 Training game complete — saved to profile' : 'Game over — stats updated')
          : (isWinner ? '🏆 YOU WON! Settling on-chain…' : '💀 YOU LOST. Better luck next game.'),
      });
      setActionTimer(null);
      setNextHandCountdown(null);
      if (isWinner && !isArena) {
        setVictory(v => ({
          ...(v || {}),
          winner,
          gameId: gameId ?? v?.gameId ?? null,
          status: 'settling',
          summary: {
            ...(v?.summary || {}),
            ...(summary || {}),
          },
        }));
        socket.emit('getState', {}, (res) => {
          const me = res?.state?.players?.find(p => (p.id || '').toLowerCase() === (walletAddress || '').toLowerCase());
          setVictory(v => ({
            ...(v || {}),
            status: 'settling',
            winner,
            chipsNow: me?.chips ?? null,
            ...(typeof res?.state?.tableId === 'string' && res.state.tableId.startsWith('usdc-')
              ? { gameId: Number(res.state.tableId.replace('usdc-', '')) || null }
              : {}),
          }));
        });
      }
      setTimeout(() => {
        setGameState(null);
        setNotification(null);
      }, 4000);
    });
    socket.on('arenaSettlement', (payload) => {
      if (!payload) return;
      const isWinner = (payload.winner || '').toLowerCase() === (walletAddress || '').toLowerCase();
      if (!isWinner) return;
      setNotification({
        type: payload.status === 'mined' ? 'win' : 'lose',
        message: payload.status === 'mined'
          ? '🏆 Arena game settled on-chain (chips burned, rankings updated)'
          : `Arena settlement failed: ${payload.error || 'unknown'}`,
      });
      setTimeout(() => setNotification(null), 5000);
    });
    socket.on('usdcSettlement', (payload) => {
      if (!payload) return;
      const isWinner = (payload.winner || '').toLowerCase() === (walletAddress || '').toLowerCase();
      if (!isWinner) return;
      setVictory(v => ({
        ...(v || {}),
        ...payload,
        status: payload.status || 'settling',
        summary: {
          ...(v?.summary || {}),
          ...(payload.summary || {}),
        },
      }));
    });
    socket.on('chatMessage', ({ from, text }) => {
      setChatLog(log => [...log, { from, text }]);
    });

    socketRef.current = socket;

    return () => { socket.disconnect(); socketRef.current = null; };
  }, [authToken, walletAddress]);

  const refreshTableState = useCallback(() => {
    return new Promise((resolve) => {
      socketRef.current?.emit('getState', {}, (res) => {
        if (res?.state) setGameState(res.state);
        resolve(res?.state ?? null);
      });
    });
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────────
  const joinTable = useCallback((tableId, buyIn) => {
    return new Promise((resolve, reject) => {
      socketRef.current?.emit('joinTable', { tableId, buyIn }, (res) => {
        if (res?.error) reject(new Error(res.error));
        else { setGameState(res.state); resolve(res.state); }
      });
    });
  }, []);

  const joinUsdcTable = useCallback((gameId, creatorAddress) => {
    return new Promise((resolve, reject) => {
      socketRef.current?.emit('joinUsdcTable', { gameId, creatorAddress }, (res) => {
        if (res?.error) reject(new Error(res.error));
        else { setGameState(res.state); resolve(res.state); }
      });
    });
  }, []);

  const joinArenaTable = useCallback(({ gameId, tier = 'unranked', botAddress } = {}) => {
    return new Promise((resolve, reject) => {
      socketRef.current?.emit('joinArenaTable', { gameId, tier, botAddress }, (res) => {
        if (res?.error) reject(new Error(res.error));
        else { setGameState(res.state); resolve(res.state); }
      });
    });
  }, []);

  const leaveTable = useCallback(() => {
    return new Promise((resolve, reject) => {
      socketRef.current?.emit('leaveTable', {}, (res) => {
        if (res?.error) reject(new Error(res.error));
        else {
          setGameState(null);
          setNotification(null);
          resolve(res);
        }
      });
    });
  }, []);

  const playerAction = useCallback((action, amount) => {
    return new Promise((resolve, reject) => {
      socketRef.current?.emit('playerAction', { action, amount }, (res) => {
        if (res?.error) reject(new Error(res.error));
        else resolve(res);
      });
    });
  }, []);

  const startGame = useCallback(() => {
    return new Promise((resolve, reject) => {
      socketRef.current?.emit('startGame', {}, (res) => {
        if (res?.error) reject(new Error(res.error));
        else { if (res?.state) setGameState(res.state); resolve(res); }
      });
    });
  }, []);

  const terminateGame = useCallback(() => {
    return new Promise((resolve, reject) => {
      socketRef.current?.emit('terminateGame', {}, (res) => {
        if (res?.error) reject(new Error(res.error));
        else { setGameState(null); setNotification(null); resolve(res); }
      });
    });
  }, []);

  const sendChat = useCallback((text) => {
    socketRef.current?.emit('chatMessage', { text });
  }, []);

  const notifyDeposit = useCallback((netAmount) => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      console.warn('Socket not connected; chip balance will update when reconnected.');
    }
    socket?.emit('chipDeposited', { netAmount }, (ack) => {
      if (ack?.chips != null) setChips(ack.chips);
      if (ack?.error) console.error('chipDeposited ack error:', ack.error);
    });
  }, []);

  const dismissVictory = useCallback(() => setVictory(null), []);

  return (
    <GameContext.Provider value={{
      connected, gameState, chips, notification,
      lastHand, victory, actionTimer, nextHandCountdown, tables, error, chatLog,
      joinTable, joinUsdcTable, joinArenaTable, leaveTable, playerAction, startGame, terminateGame, notifyDeposit, refreshTableState, sendChat,
      dismissVictory,
      setChips,
    }}>
      {children}
    </GameContext.Provider>
  );
}

export const useGame = () => {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used inside GameProvider');
  return ctx;
};
