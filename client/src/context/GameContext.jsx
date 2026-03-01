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
  const [tables,      setTables]      = useState([]);
  const [error,       setError]       = useState(null);

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
      setError(err.message);
      setConnected(false);
    });

    socket.on('gameState',   (state) => setGameState(state));
    socket.on('handStarted', (info)  => {
      setNotification({ type: 'hand', message: `Hand #${info.handNumber} starting!` });
    });
    socket.on('handComplete', (result) => setLastHand(result));
    socket.on('chipsUpdated', ({ chips }) => setChips(chips));
    socket.on('winNotification', ({ amount }) => {
      setNotification({ type: 'win', message: `You won ${amount} chips! 🎉` });
      setTimeout(() => setNotification(null), 4000);
    });
    socket.on('playerJoined',   () => refreshState(socket));
    socket.on('playerLeft',     () => refreshState(socket));
    socket.on('tableTerminated', () => {
      setGameState(null);
      setNotification(null);
    });

    socketRef.current = socket;

    return () => { socket.disconnect(); socketRef.current = null; };
  }, [authToken, walletAddress]);

  function refreshState(socket) {
    socket.emit('getState', {}, (res) => {
      if (res?.state) setGameState(res.state);
    });
  }

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

  const joinUsdcTable = useCallback((gameId) => {
    return new Promise((resolve, reject) => {
      socketRef.current?.emit('joinUsdcTable', { gameId }, (res) => {
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

  return (
    <GameContext.Provider value={{
      connected, gameState, chips, notification,
      lastHand, tables, error,
      joinTable, joinUsdcTable, leaveTable, playerAction, startGame, terminateGame, notifyDeposit, refreshTableState,
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
