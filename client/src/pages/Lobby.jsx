import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount, useWriteContract, useReadContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import {
  SERVER_URL, SERVER_API_KEY,
  TOKEN_ADDRESS, VAULT_ADDRESS, TOKEN_DECIMALS, TOKEN_SYMBOL,
  VAULT_ABI, ERC20_ABI, CHAIN_ID, ANVIL_RPC_URL,
  USDC_ADDRESS, USDC_DECIMALS, ZAX_MIGGY_VAULT_ADDRESS, ZAX_MIGGY_VAULT_ABI,
  isBaseWithUsdc,
} from '../utils/web3Config';
import { useGame } from '../context/GameContext';

const STAKE_CONFIGS = {
  'micro-1': { name: 'Micro',       blinds: '1/2',     color: '#22c55e',  bg: 'rgba(34,197,94,0.1)' },
  'low-1':   { name: 'Low',         blinds: '5/10',    color: '#3b82f6',  bg: 'rgba(59,130,246,0.1)' },
  'mid-1':   { name: 'Mid Stakes',  blinds: '25/50',   color: '#a855f7',  bg: 'rgba(168,85,247,0.1)' },
  'high-1':  { name: 'High Roller', blinds: '100/200', color: '#f59e0b',  bg: 'rgba(245,158,11,0.1)' },
};

function StatBadge({ label, value, color }) {
  return (
    <div className="flex flex-col items-center px-4 py-2 rounded-xl"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="text-xs text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="text-lg font-bold mt-0.5" style={{ color: color || '#e2e8f0' }}>{value}</div>
    </div>
  );
}

function TableCard({ tableId, info, onJoin, disabled }) {
  const cfg   = STAKE_CONFIGS[tableId] || {};
  const spots = (info?.maxSeats || 9) - (info?.players || 0);

  return (
    <div className="relative rounded-2xl overflow-hidden cursor-pointer group transition-all duration-300 hover:-translate-y-1"
      style={{ background: `linear-gradient(135deg, ${cfg.bg}, rgba(0,0,0,0.4))`,
        border: `1px solid ${cfg.color}40`, boxShadow: `0 4px 24px ${cfg.color}10` }}
      onClick={() => !disabled && onJoin(tableId)}>

      {/* Gradient edge */}
      <div className="absolute top-0 left-0 right-0 h-0.5"
        style={{ background: `linear-gradient(90deg, transparent, ${cfg.color}, transparent)` }} />

      <div className="p-5">
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="font-bold text-white text-lg">{cfg.name}</div>
            <div className="text-sm mt-0.5" style={{ color: cfg.color }}>
              Blinds {cfg.blinds}
            </div>
          </div>
          <div className="rounded-lg px-3 py-1 text-xs font-bold"
            style={{ background: `${cfg.color}20`, color: cfg.color, border: `1px solid ${cfg.color}40` }}>
            {info?.players || 0}/{info?.maxSeats || 9}
          </div>
        </div>

        <div className="flex justify-between text-sm text-gray-400">
          <span>🪑 {spots} seat{spots !== 1 ? 's' : ''} open</span>
          <span className="capitalize"
            style={{ color: info?.stage === 'waiting' ? '#64748b' : '#4ade80' }}>
            {info?.stage || 'waiting'}
          </span>
        </div>
      </div>

      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center rounded-2xl"
        style={{ background: `${cfg.color}15` }}>
        <div className="font-bold text-white text-lg tracking-wide">JOIN TABLE →</div>
      </div>
    </div>
  );
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const contractsDeployed = () => {
  const t = (TOKEN_ADDRESS || '').toLowerCase();
  const v = (VAULT_ADDRESS || '').toLowerCase();
  return t && v && t !== ZERO_ADDRESS && v !== ZERO_ADDRESS;
};

const WRONG_NETWORK_MSG = (
  <>
    Your wallet is on a different network. For local dev you must use <strong>Anvil Local (Chain ID 31337)</strong>.
    In MetaMask: Add network → Name <strong>Anvil Local</strong>, RPC URL <strong>{ANVIL_RPC_URL}</strong>, Chain ID <strong>31337</strong>. Then switch to that network.
  </>
);

function DepositModal({ onClose, onDeposited }) {
  const { address, chainId } = useAccount();
  const [amount,  setAmount]  = useState('');
  const [step,    setStep]    = useState('input'); // input | approving | depositing | done
  const [txHash,  setTxHash]  = useState(null);
  const [error,   setError]   = useState(null);

  const { writeContractAsync } = useWriteContract();
  const wrongNetwork = chainId != null && Number(chainId) !== CHAIN_ID;

  // Don't call contracts if not deployed (avoids "burn address" / "not a contract" errors)
  const deployed = contractsDeployed();

  // Read current allowance (only when contracts deployed)
  const { data: allowance } = useReadContract({
    address: deployed ? TOKEN_ADDRESS : undefined,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [address, VAULT_ADDRESS],
    watch: true,
  });

  const { data: tokenBalance } = useReadContract({
    address: deployed ? TOKEN_ADDRESS : undefined,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address],
    watch: true,
  });

  async function handleDeposit() {
    if (!amount || Number(amount) <= 0) return;
    setError(null);
    const gross = parseUnits(amount, TOKEN_DECIMALS);

    try {
      // Step 1: Approve if needed
      if (!allowance || allowance < gross) {
        setStep('approving');
        const approveTx = await writeContractAsync({
          address: TOKEN_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [VAULT_ADDRESS, gross],
        });
        setTxHash(approveTx);
        // Wait is handled via useWaitForTransactionReceipt in production
        await new Promise(r => setTimeout(r, 4000)); // simplified wait
      }

      // Step 2: Deposit
      setStep('depositing');
      const depositTx = await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: 'deposit',
        args: [gross],
      });
      setTxHash(depositTx);
      await new Promise(r => setTimeout(r, 4000));

      // Net chips after 8% fee
      const feeBps = 800;
      const net = Math.floor(Number(amount) * (10000 - feeBps) / 10000);
      onDeposited(net);
      setStep('done');
    } catch (err) {
      console.error(err);
      const msg = err.shortMessage || err.message || '';
      const isWrongAccount = /different account|another account|account selected/i.test(msg);
      const isWrongChain = /invalid chain id|chain id for signer/i.test(msg);
      setError(isWrongChain
        ? `Wrong network. Switch your wallet to Anvil Local (Chain ID 31337). In MetaMask: Add network → RPC ${ANVIL_RPC_URL}, Chain ID 31337, then switch to it.`
        : isWrongAccount
          ? 'Your wallet is set to a different account. In MetaMask (or your wallet), switch back to the account you used to sign in (see top right), then try again.'
          : msg);
      setStep('input');
    }
  }

  const balance = tokenBalance ? Number(formatUnits(tokenBalance, TOKEN_DECIMALS)).toFixed(2) : '—';
  const netPreview = amount ? Math.floor(Number(amount) * 0.92).toLocaleString() : null; // 8% fee

  if (!deployed) {
    return (
      <div className="fixed inset-0 flex items-center justify-center z-50"
        style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)' }}>
        <div className="w-full max-w-md rounded-2xl p-6"
          style={{ background: '#0f172a', border: '1px solid rgba(251,191,36,0.3)',
            boxShadow: '0 0 60px rgba(251,191,36,0.1)' }}>
          <div className="flex justify-between items-center mb-4">
            <div className="text-white font-bold text-xl">Buy Chips</div>
            <button onClick={onClose} className="text-gray-500 hover:text-white text-xl transition-colors">✕</button>
          </div>
          <div className="rounded-xl p-4 mb-4"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
            <p className="text-red-300 font-bold mb-2">Token and vault not deployed</p>
            <p className="text-gray-400 text-sm mb-3">
              Your app is still pointing at the zero address, so the wallet correctly blocks the request. Deploy the local contracts and set the addresses in <code className="text-gray-300">client/.env</code> and <code className="text-gray-300">server/.env</code>.
            </p>
            <p className="text-gray-500 text-xs font-mono break-all mb-2">From project root:</p>
            <ol className="text-gray-400 text-xs list-decimal list-inside space-y-1 mb-3">
              <li>Start anvil: <code className="text-amber-300">anvil</code></li>
              <li>Deploy: <code className="text-amber-300">cd contracts && forge script script/DeployLocal.s.sol:DeployLocal --rpc-url http://127.0.0.1:8545 --broadcast --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80</code></li>
              <li>Copy the printed TOKEN_ADDRESS and VAULT_ADDRESS into <code className="text-amber-300">client/.env</code> and <code className="text-amber-300">server/.env</code></li>
              <li>Restart the client (and server if you changed server/.env)</li>
            </ol>
            <p className="text-gray-500 text-xs">Then &quot;Buy Chips&quot; will work.</p>
          </div>
          <button onClick={onClose}
            className="w-full py-2.5 rounded-xl font-bold text-sm text-gray-300"
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full max-w-md rounded-2xl p-6"
        style={{ background: '#0f172a', border: '1px solid rgba(251,191,36,0.3)',
          boxShadow: '0 0 60px rgba(251,191,36,0.1)' }}>

        <div className="flex justify-between items-center mb-5">
          <div className="text-white font-bold text-xl">Buy Chips</div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl transition-colors">✕</button>
        </div>
        <p className="text-gray-500 text-xs mb-3">
          Use the same wallet account you signed in with (the one shown in the top right).
        </p>

        {wrongNetwork && (
          <div className="rounded-xl p-4 mb-4 text-sm"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
            <p className="text-red-300 font-bold mb-2">Wrong network</p>
            <p className="text-gray-300 mb-0">{WRONG_NETWORK_MSG}</p>
          </div>
        )}

        <div className="rounded-xl p-3 mb-4 flex justify-between items-center"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <span className="text-gray-400 text-sm">Your {TOKEN_SYMBOL} balance</span>
          <span className="text-white font-mono font-bold">{balance} {TOKEN_SYMBOL}</span>
        </div>

        <div className="mb-4">
          <label className="text-gray-400 text-sm block mb-2">Amount ({TOKEN_SYMBOL})</label>
          <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="Enter amount"
            className="w-full px-4 py-3 rounded-xl text-white font-mono text-lg"
            style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', outline: 'none' }} />
        </div>

        {/* Fee breakdown */}
        {netPreview && (
          <div className="rounded-xl p-3 mb-4"
            style={{ background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.2)' }}>
            <div className="flex justify-between text-sm mb-1.5">
              <span className="text-gray-400">Gross amount</span>
              <span className="text-white">{Number(amount).toLocaleString()} {TOKEN_SYMBOL}</span>
            </div>
            <div className="flex justify-between text-sm mb-1.5">
              <span className="text-gray-400">Buy-in fee (8%)</span>
              <span className="text-red-400">-{Math.floor(Number(amount) * 0.08).toLocaleString()} {TOKEN_SYMBOL}</span>
            </div>
            <div className="flex justify-between text-sm font-bold border-t pt-1.5"
              style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
              <span className="text-gray-300">Chips credited</span>
              <span className="text-green-400">{netPreview} chips</span>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-3 text-red-400 text-sm rounded-lg px-3 py-2"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
            {error}
          </div>
        )}

        <button onClick={handleDeposit}
          disabled={!amount || step !== 'input' || wrongNetwork}
          className="w-full py-3.5 rounded-xl font-bold text-base transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'linear-gradient(135deg, #b45309, #d97706)',
            color: '#fff8e7', boxShadow: '0 4px 20px rgba(245,158,11,0.3)' }}>
          {step === 'input'      && `Buy ${netPreview ? `${netPreview} chips` : 'Chips'}`}
          {step === 'approving'  && '⏳ Approving token...'}
          {step === 'depositing' && '⏳ Depositing...'}
          {step === 'done'       && '✅ Chips added!'}
        </button>

        <p className="text-gray-600 text-xs text-center mt-3">
          5% cashout fee applies when withdrawing winnings
        </p>
      </div>
    </div>
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
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [address, ZAX_MIGGY_VAULT_ADDRESS],
    watch: true,
  });
  const { data: usdcBalance } = useReadContract({
    address: usdcVaultReady() ? USDC_ADDRESS : undefined,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address],
    watch: true,
  });
  const { data: nextGameIdData, refetch: refetchNextGameId } = useReadContract({
    address: usdcVaultReady() ? ZAX_MIGGY_VAULT_ADDRESS : undefined,
    abi: ZAX_MIGGY_VAULT_ABI,
    functionName: 'nextGameId',
  });

  async function handleCreate() {
    if (!amount || Number(amount) <= 0) return;
    setError(null);
    const raw = parseUnits(amount, USDC_DECIMALS);
    try {
      if (!usdcAllowance || usdcAllowance < raw) {
        setStep('approving');
        await writeContractAsync({
          address: USDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [ZAX_MIGGY_VAULT_ADDRESS, raw],
        });
        await new Promise(r => setTimeout(r, 3000));
      }
      setStep('creating');
      await writeContractAsync({
        address: ZAX_MIGGY_VAULT_ADDRESS,
        abi: ZAX_MIGGY_VAULT_ABI,
        functionName: 'createGame',
        args: [raw],
      });
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
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full max-w-md rounded-2xl p-6" style={{ background: '#0f172a', border: '1px solid rgba(59,130,246,0.3)', boxShadow: '0 0 60px rgba(59,130,246,0.1)' }}>
        <div className="flex justify-between items-center mb-4">
          <div className="text-white font-bold text-xl">Create USDC Table</div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl">✕</button>
        </div>
        <p className="text-gray-500 text-xs mb-3">Set the table cost in USDC. You deposit this amount to create the game; others must deposit the same to join.</p>
        {wrongNetwork && (
          <div className="rounded-xl p-3 mb-4 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
            <p className="text-red-300 font-bold">Wrong network</p>
            <p className="text-gray-300">Switch to {CHAIN_ID === 8453 ? 'Base' : `Chain ID ${CHAIN_ID}`}.</p>
          </div>
        )}
        <div className="rounded-xl p-3 mb-4 flex justify-between items-center" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <span className="text-gray-400 text-sm">Your USDC</span>
          <span className="text-white font-mono font-bold">{balance} USDC</span>
        </div>
        {step !== 'done' ? (
          <>
            <div className="mb-4">
              <label className="text-gray-400 text-sm block mb-2">Table cost (USDC)</label>
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 5"
                className="w-full px-4 py-3 rounded-xl text-white font-mono text-lg" style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', outline: 'none' }} />
            </div>
            {error && <div className="mb-3 text-red-400 text-sm">{error}</div>}
            <button onClick={handleCreate} disabled={!amount || step === 'approving' || step === 'creating' || wrongNetwork}
              className="w-full py-3.5 rounded-xl font-bold text-base disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #1d4ed8, #3b82f6)', color: '#fff' }}>
              {step === 'input' && 'Create game'}
              {step === 'approving' && '⏳ Approving USDC...'}
              {step === 'creating' && '⏳ Creating game...'}
            </button>
          </>
        ) : (
          <div className="rounded-xl p-4 mb-4" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)' }}>
            <p className="text-green-300 font-bold mb-2">Game created</p>
            <p className="text-gray-300 text-sm">Game ID: <span className="font-mono text-white">{gameId}</span></p>
            <p className="text-gray-500 text-xs mt-2">Share this ID so others can join. Table cost: {amount} USDC.</p>
            <button onClick={() => onCreated?.(gameId)}
              className="w-full mt-4 py-2.5 rounded-xl font-bold text-sm text-white"
              style={{ background: 'linear-gradient(135deg, #15803d, #22c55e)' }}>
              🃏 Go to table
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function JoinUsdcGameModal({ onClose, onJoined }) {
  const { address, chainId } = useAccount();
  const { connected } = useGame();
  const navigate = useNavigate();
  const [gameIdInput, setGameIdInput] = useState('');
  const [step, setStep] = useState('input');
  const [error, setError] = useState(null);
  const { writeContractAsync } = useWriteContract();
  const wrongNetwork = chainId != null && Number(chainId) !== CHAIN_ID;

  const gameId = gameIdInput.trim() === '' ? null : (parseInt(gameIdInput, 10) | 0);
  const validGameId = gameId != null && gameId >= 0 ? gameId : null;
  const { data: rawGameData, error: readError } = useReadContract({
    address: usdcVaultReady() && validGameId != null ? ZAX_MIGGY_VAULT_ADDRESS : undefined,
    abi: ZAX_MIGGY_VAULT_ABI,
    functionName: 'getGame',
    args: validGameId != null ? [BigInt(validGameId)] : undefined,
  });

  // Wagmi/viem can return tuple as array or as object with named keys; normalize to one shape
  const gameData = (() => {
    if (rawGameData == null) return null;
    if (Array.isArray(rawGameData)) return rawGameData;
    if (typeof rawGameData === 'object' && rawGameData !== null) {
      const o = rawGameData;
      return [o.players, o.playerCount, o.depositAmount, o.createdAt, o.finished, o.winner];
    }
    return null;
  })();

  const [players, playerCount, depositAmount, createdAt, finished, winner] = gameData || [];
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
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [address, ZAX_MIGGY_VAULT_ADDRESS],
    watch: true,
  });

  async function handleJoin() {
    if (validGameId == null || !depositAmount) return;
    setError(null);
    try {
      if (!usdcAllowance || usdcAllowance < depositAmount) {
        setStep('approving');
        await writeContractAsync({
          address: USDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [ZAX_MIGGY_VAULT_ADDRESS, depositAmount],
        });
        await new Promise(r => setTimeout(r, 3000));
      }
      setStep('joining');
      await writeContractAsync({
        address: ZAX_MIGGY_VAULT_ADDRESS,
        abi: ZAX_MIGGY_VAULT_ABI,
        functionName: 'joinGame',
        args: [BigInt(validGameId)],
      });
      await new Promise(r => setTimeout(r, 4000));
      onJoined?.();
      navigate(`/game/${validGameId}`);
      onClose();
    } catch (err) {
      setError(err.shortMessage || err.message || 'Transaction failed');
      setStep('input');
    }
  }

  function handleGoToTable() {
    navigate(`/game/${validGameId}`);
    onClose();
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full max-w-md rounded-2xl p-6" style={{ background: '#0f172a', border: '1px solid rgba(59,130,246,0.3)', boxShadow: '0 0 60px rgba(59,130,246,0.1)' }}>
        <div className="flex justify-between items-center mb-4">
          <div className="text-white font-bold text-xl">Join USDC Table</div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl">✕</button>
        </div>
        <p className="text-gray-500 text-xs mb-3">Enter the game ID (from the table creator) to join. You will deposit the table cost in USDC.</p>
        {!usdcVaultReady() && (
          <p className="text-amber-400 text-xs mb-4">Connect to Base and set vault address (VITE_ZAX_MIGGY_VAULT_ADDRESS) to join USDC games.</p>
        )}
        {wrongNetwork && (
          <div className="rounded-xl p-3 mb-4 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
            <p className="text-red-300 font-bold">Wrong network</p>
            <p className="text-gray-300">Switch to {CHAIN_ID === 8453 ? 'Base' : `Chain ID ${CHAIN_ID}`}.</p>
          </div>
        )}
        <div className="mb-4">
          <label className="text-gray-400 text-sm block mb-2">Game ID</label>
          <input type="number" value={gameIdInput} onChange={e => setGameIdInput(e.target.value)} placeholder="0"
            className="w-full px-4 py-3 rounded-xl text-white font-mono text-lg" style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', outline: 'none' }} />
        </div>
        {validGameId == null && gameIdInput.trim() !== '' && (
          <p className="text-amber-400 text-xs mb-3">Enter a valid game ID (e.g. 0).</p>
        )}
        {validGameId != null && depositAmountNum == null && !gameData && (
          <p className="text-gray-500 text-xs mb-3">Loading game details…</p>
        )}
        {validGameId != null && readError && (
          <div className="rounded-xl p-3 mb-4 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
            <p className="text-red-300 font-medium">Couldn’t load game</p>
            <p className="text-gray-400 text-xs mt-1">{readError.message}</p>
            <p className="text-amber-300 text-xs mt-2">Switch your wallet to <strong>Base</strong> network and refresh. If using WalletConnect, try MetaMask or another wallet.</p>
          </div>
        )}
        {validGameId != null && gameData && count === 0 && (depositAmount == null || depositAmount === 0n) && (
          <p className="text-amber-400 text-xs mb-3">No game found with this ID. Check the number and try again.</p>
        )}
        {depositAmountNum != null && depositAmountNum > 0 && (
          <div className="rounded-xl p-3 mb-4" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Table cost</span>
              <span className="text-white font-mono">{depositAmountNum} USDC</span>
            </div>
            <div className="flex justify-between text-sm mt-1">
              <span className="text-gray-400">Players</span>
              <span className="text-white">{count}/8</span>
            </div>
            {isCreator && (
              <p className="text-green-400 text-xs font-medium mt-3 pt-3 border-t border-white/10">
                You created this game. Share game ID <span className="font-mono text-white">{validGameId}</span> so others can join.
              </p>
            )}
            {isAlreadyInGame && !isCreator && (
              <p className="text-amber-400 text-xs font-medium mt-3 pt-3 border-t border-white/10">
                You’re already in this game.
              </p>
            )}
            {finished && <p className="text-amber-400 text-xs mt-2">This game is finished.</p>}
          </div>
        )}
        {error && (
          <div className="mb-4 p-3 rounded-xl text-sm" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)' }}>
            <p className="text-red-300 font-medium">{error}</p>
            {error.includes('Already at a table') && (
              <p className="text-gray-400 text-xs mt-2">Use &quot;Leave table&quot; on the table screen first, or you will be taken back to your current table.</p>
            )}
            {(/resource|not available|unavailable/i.test(error)) && (
              <p className="text-amber-300 text-xs mt-2">Switch your wallet to <strong>Base</strong> network, refresh the page, then try again.</p>
            )}
          </div>
        )}
        {(isCreator || isAlreadyInGame) && !finished && depositAmountNum != null && depositAmountNum > 0 && (
          <button onClick={handleGoToTable} disabled={!connected}
            className="w-full py-3 rounded-xl font-bold text-sm mb-4 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #15803d, #22c55e)', color: '#fff' }}>
            {connected ? '🃏 Go to table' : '⏳ Connecting…'}
          </button>
        )}
        <button onClick={handleJoin} disabled={!canJoin || step === 'approving' || step === 'joining' || wrongNetwork}
          className="w-full py-3.5 rounded-xl font-bold text-base disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, #1d4ed8, #3b82f6)', color: '#fff' }}>
          {step === 'input' && 'Join game'}
          {step === 'approving' && '⏳ Approving USDC...'}
          {step === 'joining' && '⏳ Joining...'}
        </button>
      </div>
    </div>
  );
}

export default function Lobby({ token, address }) {
  const { chips, joinTable, notifyDeposit } = useGame();
  const navigate = useNavigate();
  const [tables,      setTables]      = useState({});
  const [showDeposit, setShowDeposit] = useState(false);
  const [showCreateUsdc, setShowCreateUsdc] = useState(false);
  const [showJoinUsdc, setShowJoinUsdc] = useState(false);
  const [joinError,   setJoinError]   = useState(null);
  const [joining,     setJoining]     = useState(null);

  useEffect(() => {
    async function fetchTables() {
      try {
        const res = await fetch(`${SERVER_URL}/tables`, {
          headers: { 'X-Poker-Key': SERVER_API_KEY, 'Authorization': `Bearer ${token}` },
        });
        const list = await res.json();
        const map  = {};
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
    const tableInfo = tables[tableId];
    const cfg = STAKE_CONFIGS[tableId] || {};
    // Default to minimum buy-in
    const minBuyIn = tableId.startsWith('micro') ? 40
      : tableId.startsWith('low')   ? 200
      : tableId.startsWith('mid')   ? 1000
      : 4000;

    if (chips < minBuyIn) {
      setJoinError(`Need at least ${minBuyIn} chips. Buy some first!`);
      setJoining(null);
      return;
    }
    try {
      await joinTable(tableId, minBuyIn);
    } catch (err) {
      setJoinError(err.message);
    }
    setJoining(null);
  }

  // Base + USDC: only USDC flow (buy into game → pseudo chips for gameplay)
  const usdcOnlyMode = isBaseWithUsdc();

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* Header stats */}
      <div className="flex gap-4 mb-8 flex-wrap">
        <StatBadge label="Address" value={`${address.slice(0,6)}...${address.slice(-4)}`} />
        {usdcOnlyMode ? (
          <StatBadge label="Winner fee" value="10%" color="#f87171" />
        ) : (
          <>
            <StatBadge label="Your Chips"  value={chips.toLocaleString()}  color="#fbbf24" />
            <StatBadge label="Buy-in Fee"  value="8%"  color="#f87171" />
            <StatBadge label="Cashout Fee" value="5%"  color="#f87171" />
            <button onClick={() => setShowDeposit(true)}
              className="ml-auto self-center px-5 py-2.5 rounded-xl font-bold text-sm transition-all hover:scale-105 active:scale-95"
              style={{ background: 'linear-gradient(135deg, #b45309, #d97706)',
                color: '#fff8e7', boxShadow: '0 4px 16px rgba(245,158,11,0.3)' }}>
              + Buy Chips
            </button>
          </>
        )}
      </div>

      {usdcOnlyMode ? (
        // USDC-only: create or join a game; chips are administered per game
        <>
          <div className="text-white font-bold text-xl mb-4">USDC Games (Base)</div>
          <p className="text-gray-500 text-sm mb-6">
            Create a game with your chosen buy-in in USDC, or join an existing game by ID.
            You deposit USDC to enter; chips are administered for gameplay. 10% fee on winner payout.
          </p>
          <div className="flex gap-4 flex-wrap">
            <button onClick={() => setShowCreateUsdc(true)}
              className="px-5 py-2.5 rounded-xl font-bold text-sm"
              style={{ background: 'linear-gradient(135deg, #1d4ed8, #3b82f6)', color: '#fff' }}>
              Create game
            </button>
            <button onClick={() => setShowJoinUsdc(true)}
              className="px-5 py-2.5 rounded-xl font-bold text-sm"
              style={{ background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.5)', color: '#93c5fd' }}>
              Join game
            </button>
          </div>
        </>
      ) : (
        // Chip-based tables (local / PokerVault)
        <>
          <div className="rounded-xl p-4 mb-8 flex gap-4 flex-wrap"
            style={{ background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.15)' }}>
            <div className="text-sm text-gray-400">
              <span className="text-yellow-300 font-bold">How fees work: </span>
              8% is deducted when you buy chips. When you win a hand and cash out, 5% is deducted from your payout.
              <strong className="text-white"> Winners always come out ahead</strong> — the net win after fees is still substantial.
            </div>
          </div>

          <div className="text-white font-bold text-xl mb-4">Choose Your Table</div>

          {joinError && (
            <div className="mb-4 text-red-400 rounded-xl px-4 py-3 text-sm"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
              {joinError}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {Object.entries(STAKE_CONFIGS).map(([tableId]) => (
              <TableCard key={tableId} tableId={tableId} info={tables[tableId]}
                onJoin={handleJoin} disabled={!!joining} />
            ))}
          </div>

          {usdcVaultReady() && (
            <div className="mt-10 pt-8 border-t border-white/10">
              <div className="text-white font-bold text-xl mb-4">USDC Tables (Base)</div>
              <p className="text-gray-500 text-sm mb-4">
                Create a table with your chosen buy-in in USDC, or join an existing game by ID. 10% fee on winner payout.
              </p>
              <div className="flex gap-4 flex-wrap">
                <button onClick={() => setShowCreateUsdc(true)}
                  className="px-5 py-2.5 rounded-xl font-bold text-sm"
                  style={{ background: 'linear-gradient(135deg, #1d4ed8, #3b82f6)', color: '#fff' }}>
                  Create game
                </button>
                <button onClick={() => setShowJoinUsdc(true)}
                  className="px-5 py-2.5 rounded-xl font-bold text-sm"
                  style={{ background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.5)', color: '#93c5fd' }}>
                  Join game
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {showDeposit && (
        <DepositModal
          onClose={() => setShowDeposit(false)}
          onDeposited={(net) => { notifyDeposit(net); setShowDeposit(false); }}
        />
      )}
      {showCreateUsdc && (
        <CreateUsdcGameModal
          onClose={() => setShowCreateUsdc(false)}
          onCreated={(id) => { navigate(`/game/${id}`); setShowCreateUsdc(false); }}
        />
      )}
      {showJoinUsdc && (
        <JoinUsdcGameModal onClose={() => setShowJoinUsdc(false)} />
      )}
    </div>
  );
}
