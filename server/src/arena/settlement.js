import { AbiCoder, concat, keccak256, getBytes } from 'ethers';
import { ethers } from 'ethers';
import config from '../config.js';
import { getServerSignerAddress } from '../security.js';

const SETTLEMENT_SCHEMA_VERSION = 1n;
const coder = AbiCoder.defaultAbiCoder();

const ARENA_ABI = [
  'function settlementSigner() view returns (address)',
  `function settleGame(
    tuple(
      uint256 schemaVersion,
      uint256 gameId,
      uint8 tier,
      uint256 handCount,
      uint256 startedAt,
      uint256 endedAt,
      bytes32 tableConfigHash,
      tuple(address bot, uint256 chipsStart, uint256 chipsEnd, uint16 handsWon, bool winner, uint256 preGameScore)[] players,
      bytes32 handSummaryRoot,
      uint256 nonce,
      bytes32 resultHash
    ) settlement
  ) external`,
];

let _arena = null;

function getArenaContract() {
  if (_arena) return _arena;
  const addr = config.chain.arenaAddress;
  if (!addr) return null;
  const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);
  const wallet = new ethers.Wallet(config.server.signerPrivKey, provider);
  _arena = new ethers.Contract(addr, ARENA_ABI, wallet);
  return _arena;
}

function toBytes32(value) {
  if (!value) return ethers.ZeroHash;
  if (typeof value === 'string' && value.startsWith('0x') && value.length === 66) {
    return value;
  }
  return keccak256(getBytes(value));
}

/**
 * Matches AgenticArenaTypes.hashSettlement in contracts.
 */
export function hashArenaSettlement(payload) {
  const packedParts = payload.players.map((p) =>
    coder.encode(
      ['address', 'uint16', 'bool', 'uint16', 'uint256', 'uint256', 'uint256'],
      [
        p.bot,
        p.seat,
        p.winner,
        p.handsWon,
        p.chipsStart,
        p.chipsEnd,
        p.preGameScore,
      ],
    ),
  );
  const packedPlayers = packedParts.length ? concat(packedParts) : '0x';
  const playersHash = keccak256(packedPlayers);

  return keccak256(
    coder.encode(
      [
        'uint256',
        'uint256',
        'uint8',
        'uint256',
        'uint256',
        'uint256',
        'bytes32',
        'bytes32',
        'uint256',
        'bytes32',
      ],
      [
        payload.schemaVersion,
        payload.gameId,
        payload.tier,
        payload.handCount,
        payload.startedAt,
        payload.endedAt,
        payload.tableConfigHash,
        payload.handSummaryRoot,
        payload.nonce,
        playersHash,
      ],
    ),
  );
}

/**
 * Build on-chain settlement from live table + DB row.
 */
export function buildArenaSettlement(table, dbGame, onChainGameId) {
  const gameId = BigInt(onChainGameId);
  const tier = Number(dbGame?.tier ?? table.arenaTier ?? 0);
  const handCount = BigInt(table.handNumber ?? dbGame?.hand_count ?? 0);
  const startedAt = BigInt(
    dbGame?.created_at ? Math.floor(new Date(dbGame.created_at).getTime() / 1000) : Math.floor(Date.now() / 1000),
  );
  const endedAt = BigInt(Math.floor(Date.now() / 1000));
  const tableConfigHash = toBytes32(dbGame?.settings_hash);
  const handSummaryRoot = keccak256(coder.encode(['string'], ['arena-hands-v1']));
  const nonce = BigInt(Date.now());

  const settlementPlayers = table.players.map((p, idx) => {
    const chipsEnd = BigInt(p.chips ?? 0);
    const chipsStart = BigInt(p.startChips ?? config.arena.startingChips);
    const alive = table.players.filter((x) => (x.chips ?? 0) > 0);
    const isWinner = alive.length === 1 && alive[0].id === p.id;
    return {
      bot: p.id,
      chipsStart,
      chipsEnd,
      handsWon: Number(p.handsWonThisGame ?? handCount),
      winner: isWinner,
      preGameScore: 0n,
      seat: idx,
    };
  });

  const hashPlayers = settlementPlayers.map((p) => ({
    bot: p.bot,
    seat: p.seat,
    winner: p.winner,
    handsWon: p.handsWon,
    chipsStart: p.chipsStart,
    chipsEnd: p.chipsEnd,
    preGameScore: p.preGameScore,
  }));

  const resultHash = hashArenaSettlement({
    schemaVersion: SETTLEMENT_SCHEMA_VERSION,
    gameId,
    tier,
    handCount,
    startedAt,
    endedAt,
    tableConfigHash,
    handSummaryRoot,
    nonce,
    players: hashPlayers,
  });

  const contractSettlement = {
    schemaVersion: SETTLEMENT_SCHEMA_VERSION,
    gameId,
    tier,
    handCount,
    startedAt,
    endedAt,
    tableConfigHash,
    players: settlementPlayers.map(({ bot, chipsStart, chipsEnd, handsWon, winner, preGameScore }) => ({
      bot,
      chipsStart,
      chipsEnd,
      handsWon,
      winner,
      preGameScore,
    })),
    handSummaryRoot,
    nonce,
    resultHash,
  };

  return { resultHash, settlement: contractSettlement };
}

/**
 * Submit Arena.settleGame (burns chips, updates RankingsV2). No USDC payout.
 */
export async function submitArenaSettlement(settlement) {
  const arena = getArenaContract();
  if (!arena) {
    throw new Error('ARENA_ADDRESS not configured — skipping on-chain settleGame');
  }

  const signer = getServerSignerAddress();
  const onChainSigner = await arena.settlementSigner();

  if (onChainSigner.toLowerCase() !== signer.toLowerCase()) {
    throw new Error(
      `Server signer ${signer} does not match Arena settlementSigner ${onChainSigner}`,
    );
  }

  const tx = await arena.settleGame(settlement);
  const receipt = await tx.wait();
  return { txHash: tx.hash, receipt };
}
