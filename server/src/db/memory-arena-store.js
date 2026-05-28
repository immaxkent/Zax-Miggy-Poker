/**
 * In-memory arena store for local dev/tests when Supabase is not configured.
 */
import crypto from 'node:crypto';

const bots = new Map();
const gamesByTable = new Map();
const gamesById = new Map();
const participants = new Map(); // gameId -> Map<bot, row>
const rankingEvents = [];
const stats = new Map();
const historyExports = [];

function gameKey(tableId) {
  return gamesByTable.get(tableId)?.id;
}

export const memoryArenaStore = {
  async upsertBot({ botAddress, ownerAddress, metadataUri, configUri }) {
    const row = {
      bot_address: botAddress.toLowerCase(),
      owner_address: ownerAddress.toLowerCase(),
      metadata_uri: metadataUri || null,
      config_uri: configUri || null,
      created_at: bots.get(botAddress)?.created_at || new Date().toISOString(),
    };
    bots.set(row.bot_address, row);
    if (!stats.has(row.bot_address)) {
      stats.set(row.bot_address, defaultStats(row.bot_address));
    }
    return row;
  },

  async getBot(botAddress) {
    return bots.get(botAddress.toLowerCase()) || null;
  },

  async createGame({ onChainGameId, tableId, tier, settingsHash }) {
    const id = crypto.randomUUID();
    const row = {
      id,
      on_chain_game_id: onChainGameId ?? null,
      table_id: tableId,
      tier,
      settings_hash: settingsHash || null,
      status: 'open',
      hand_count: 0,
      result_hash: null,
      created_at: new Date().toISOString(),
      settled_at: null,
    };
    gamesById.set(id, row);
    gamesByTable.set(tableId, row);
    participants.set(id, new Map());
    return row;
  },

  async getGameByTableId(tableId) {
    return gamesByTable.get(tableId) || null;
  },

  async addParticipant({ tableId, botAddress, chipsStart = 1000 }) {
    const game = gamesByTable.get(tableId);
    if (!game) throw new Error('Game not found');
    const pmap = participants.get(game.id);
    if (pmap.has(botAddress.toLowerCase())) return pmap.get(botAddress.toLowerCase());
    const row = {
      game_id: game.id,
      bot_address: botAddress.toLowerCase(),
      chips_start: chipsStart,
      chips_end: null,
      hands_won: 0,
      placement: null,
      is_winner: false,
      joined_at: new Date().toISOString(),
    };
    pmap.set(row.bot_address, row);
    if (game.status === 'open') game.status = 'in_progress';
    return row;
  },

  async listOpenGames({ tier } = {}) {
    return [...gamesByTable.values()].filter(g => {
      if (g.status !== 'open' && g.status !== 'in_progress') return false;
      if (tier != null && g.tier !== tier) return false;
      return true;
    });
  },

  async listGamesForApi() {
    return [...gamesByTable.values()].map(g => ({
      tableId: g.table_id,
      gameId: g.on_chain_game_id,
      tier: g.tier,
      status: g.status,
      handCount: g.hand_count,
      playerCount: participants.get(g.id)?.size ?? 0,
    }));
  },

  async recordHand({ tableId, handNumber, payload }) {
    const game = gamesByTable.get(tableId);
    if (!game) return;
    game.hand_count = Math.max(game.hand_count, handNumber);
  },

  async finalizeGame({ tableId, resultHash, players }) {
    const game = gamesByTable.get(tableId);
    if (!game) throw new Error('Game not found');
    const pmap = participants.get(game.id);
    let placement = 1;
    for (const p of players) {
      const addr = p.botAddress.toLowerCase();
      const row = pmap.get(addr);
      if (!row) continue;
      row.chips_end = p.chipsEnd;
      row.hands_won = p.handsWon ?? 0;
      row.is_winner = !!p.winner;
      row.placement = p.winner ? 1 : ++placement;
      await this._applyStatsFromResult(game, row);
    }
    game.status = 'settled';
    game.result_hash = resultHash || null;
    game.settled_at = new Date().toISOString();
    return game;
  },

  async getBotProfile(botAddress) {
    const addr = botAddress.toLowerCase();
    return stats.get(addr) || null;
  },

  async getBotHistory(botAddress, limit = 20) {
    const addr = botAddress.toLowerCase();
    return rankingEvents
      .filter(e => e.bot_address === addr)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  },

  async appendRankingEvent({ botAddress, gameId, eventType, payload }) {
    rankingEvents.push({
      bot_address: botAddress.toLowerCase(),
      game_id: gameId,
      event_type: eventType,
      payload: payload || {},
      created_at: new Date().toISOString(),
    });
  },

  async saveHistoryExport(botAddress, payload) {
    historyExports.push({
      bot_address: botAddress.toLowerCase(),
      version: 1,
      payload,
      created_at: new Date().toISOString(),
    });
  },

  async _applyStatsFromResult(game, row) {
    const s = stats.get(row.bot_address) || defaultStats(row.bot_address);
    s.games_played += 1;
    s.hands_won += row.hands_won;
    s.chips_net += (row.chips_end ?? 0) - row.chips_start;
    if (game.tier === 1) s.ranked_games += 1;
    if (game.tier === 2) s.elite_games += 1;
    if (row.is_winner) {
      s.games_won += 1;
      if (game.tier === 1) s.ranked_wins += 1;
      if (game.tier === 2) s.elite_wins += 1;
      s.composite_score += 100 + row.hands_won * 5;
      s.recency_score += 25;
    }
    s.updated_at = new Date().toISOString();
    stats.set(row.bot_address, s);
    await this.appendRankingEvent({
      botAddress: row.bot_address,
      gameId: game.id,
      eventType: row.is_winner ? 'game_won' : 'game_lost',
      payload: { tableId: game.table_id, tier: game.tier, chipsEnd: row.chips_end },
    });
  },
};

function defaultStats(botAddress) {
  return {
    bot_address: botAddress,
    games_played: 0,
    games_won: 0,
    hands_won: 0,
    chips_net: 0,
    ranked_games: 0,
    elite_games: 0,
    ranked_wins: 0,
    elite_wins: 0,
    composite_score: 0,
    assassin_score: 0,
    sociopath_score: 0,
    consistency_score: 0,
    recency_score: 0,
    rank_position: null,
    updated_at: new Date().toISOString(),
  };
}
