import { arenaStore, isArenaTableId } from '../db/arena-store.js';

const TIER_NAMES = ['unranked', 'ranked', 'elite'];

export function tierFromPayload(tier) {
  if (tier === 'ranked' || tier === 1) return 1;
  if (tier === 'elite' || tier === 2) return 2;
  return 0;
}

export function tierName(tier) {
  return TIER_NAMES[tier] ?? 'unranked';
}

/**
 * Register arena table + first participant when a bot/human joins.
 */
export async function onArenaTableJoin({
  tableId,
  gameId,
  tier,
  botAddress,
  ownerAddress,
  settingsHash,
  chipsStart = 1000,
}) {
  let game = await arenaStore.getGameByTableId(tableId);
  if (!game) {
    game = await arenaStore.createGame({
      onChainGameId: gameId != null ? Number(gameId) : null,
      tableId,
      tier: tierFromPayload(tier),
      settingsHash: settingsHash || null,
    });
  }

  if (botAddress) {
    await arenaStore.upsertBot({
      botAddress,
      ownerAddress: ownerAddress || botAddress,
    });
    await arenaStore.addParticipant({ tableId, botAddress, chipsStart });
  }

  return game;
}

export async function onArenaHandComplete(tableId, handNumber, summary) {
  if (!isArenaTableId(tableId)) return;
  await arenaStore.recordHand({ tableId, handNumber, payload: summary || {} });
}

/**
 * Finalize arena game in DB (no vault payout). Called when one player remains.
 */
export async function onArenaGameOver(table, tableId) {
  if (!isArenaTableId(tableId)) return null;

  const players = table.players.map((p, idx) => {
    const chipsEnd = p.chips;
    const chipsStart = p.startChips ?? 1000;
    const winner = chipsEnd > 0 && table.players.filter(x => x.chips > 0).length === 1
      && table.players.find(x => x.chips > 0)?.id === p.id;
    return {
      botAddress: p.id,
      chipsStart,
      chipsEnd,
      handsWon: p.handsWonThisGame ?? table.handNumber ?? 0,
      winner: !!winner,
      placement: winner ? 1 : idx + 2,
    };
  });

  const game = await arenaStore.finalizeGame({
    tableId,
    resultHash: null,
    players,
  });

  return game;
}

export async function buildBotProfileResponse(botAddress) {
  const [bot, profile, history] = await Promise.all([
    arenaStore.getBot(botAddress),
    arenaStore.getBotProfile(botAddress),
    arenaStore.getBotHistory(botAddress, 25),
  ]);

  return {
    bot,
    profile: profile || null,
    history,
    metrics: profile
      ? {
          gamesPlayed: profile.games_played,
          gamesWon: profile.games_won,
          handsWon: profile.hands_won,
          chipsNet: profile.chips_net,
          compositeScore: profile.composite_score,
          assassinScore: profile.assassin_score,
          sociopathScore: profile.sociopath_score,
          consistencyScore: profile.consistency_score,
          recencyScore: profile.recency_score,
          rankPosition: profile.rank_position,
        }
      : null,
  };
}
