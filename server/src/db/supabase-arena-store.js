import { getSupabase } from './supabase.js';

function sb() {
  const client = getSupabase();
  if (!client) throw new Error('Supabase not configured');
  return client;
}

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

export const supabaseArenaStore = {
  async upsertBot({ botAddress, ownerAddress, metadataUri, configUri }) {
    const row = {
      bot_address: botAddress.toLowerCase(),
      owner_address: ownerAddress.toLowerCase(),
      metadata_uri: metadataUri || null,
      config_uri: configUri || null,
    };
    const { data, error } = await sb()
      .from('bots')
      .upsert(row, { onConflict: 'bot_address' })
      .select()
      .single();
    if (error) throw error;
    await sb().from('bot_stats_snapshots').upsert(defaultStats(row.bot_address), { onConflict: 'bot_address' });
    return data;
  },

  async getBot(botAddress) {
    const { data, error } = await sb()
      .from('bots')
      .select('*')
      .eq('bot_address', botAddress.toLowerCase())
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async createGame({ onChainGameId, tableId, tier, settingsHash }) {
    const row = {
      on_chain_game_id: onChainGameId ?? null,
      table_id: tableId,
      tier,
      settings_hash: settingsHash || null,
      status: 'open',
    };
    const { data, error } = await sb().from('arena_games').insert(row).select().single();
    if (error) throw error;
    return data;
  },

  async getGameByTableId(tableId) {
    const { data, error } = await sb()
      .from('arena_games')
      .select('*')
      .eq('table_id', tableId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async addParticipant({ tableId, botAddress, chipsStart = 1000 }) {
    const game = await this.getGameByTableId(tableId);
    if (!game) throw new Error('Game not found');
    const row = {
      game_id: game.id,
      bot_address: botAddress.toLowerCase(),
      chips_start: chipsStart,
    };
    const { data, error } = await sb()
      .from('game_participants')
      .upsert(row, { onConflict: 'game_id,bot_address' })
      .select()
      .single();
    if (error) throw error;
    if (game.status === 'open') {
      await sb().from('arena_games').update({ status: 'in_progress' }).eq('id', game.id);
    }
    return data;
  },

  async listOpenGames({ tier } = {}) {
    let q = sb()
      .from('arena_games')
      .select('*')
      .in('status', ['open', 'in_progress']);
    if (tier != null) q = q.eq('tier', tier);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  async listGamesForApi() {
    const { data: games, error } = await sb()
      .from('arena_games')
      .select('id, table_id, on_chain_game_id, tier, status, hand_count')
      .in('status', ['open', 'in_progress', 'settled'])
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    const out = [];
    for (const g of games || []) {
      const { count } = await sb()
        .from('game_participants')
        .select('*', { count: 'exact', head: true })
        .eq('game_id', g.id);
      out.push({
        tableId: g.table_id,
        gameId: g.on_chain_game_id,
        tier: g.tier,
        status: g.status,
        handCount: g.hand_count,
        playerCount: count ?? 0,
      });
    }
    return out;
  },

  async recordHand({ tableId, handNumber, payload }) {
    const game = await this.getGameByTableId(tableId);
    if (!game) return;
    await sb().from('hand_summaries').upsert(
      { game_id: game.id, hand_number: handNumber, payload: payload || {} },
      { onConflict: 'game_id,hand_number' },
    );
    await sb()
      .from('arena_games')
      .update({ hand_count: Math.max(game.hand_count || 0, handNumber) })
      .eq('id', game.id);
  },

  async finalizeGame({ tableId, resultHash, players }) {
    const game = await this.getGameByTableId(tableId);
    if (!game) throw new Error('Game not found');

    for (const p of players) {
      await sb()
        .from('game_participants')
        .update({
          chips_end: p.chipsEnd,
          hands_won: p.handsWon ?? 0,
          is_winner: !!p.winner,
          placement: p.winner ? 1 : 2,
        })
        .eq('game_id', game.id)
        .eq('bot_address', p.botAddress.toLowerCase());

      await this._applyStatsFromResult(game, p);
    }

    const { data, error } = await sb()
      .from('arena_games')
      .update({
        status: 'settled',
        result_hash: resultHash || null,
        settled_at: new Date().toISOString(),
      })
      .eq('id', game.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async getBotProfile(botAddress) {
    const { data, error } = await sb()
      .from('bot_stats_snapshots')
      .select('*')
      .eq('bot_address', botAddress.toLowerCase())
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async getBotHistory(botAddress, limit = 20) {
    const { data, error } = await sb()
      .from('ranking_events')
      .select('*')
      .eq('bot_address', botAddress.toLowerCase())
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  },

  async appendRankingEvent({ botAddress, gameId, eventType, payload }) {
    const { error } = await sb().from('ranking_events').insert({
      bot_address: botAddress.toLowerCase(),
      game_id: gameId,
      event_type: eventType,
      payload: payload || {},
    });
    if (error) throw error;
  },

  async saveHistoryExport(botAddress, payload) {
    const { error } = await sb().from('bot_history_exports').insert({
      bot_address: botAddress.toLowerCase(),
      payload,
    });
    if (error) throw error;
  },

  async _applyStatsFromResult(game, p) {
    const addr = p.botAddress.toLowerCase();
    const { data: existing } = await sb()
      .from('bot_stats_snapshots')
      .select('*')
      .eq('bot_address', addr)
      .maybeSingle();

    const s = existing || defaultStats(addr);
    s.games_played += 1;
    s.hands_won += p.handsWon ?? 0;
    s.chips_net = Number(s.chips_net) + (p.chipsEnd - p.chipsStart);
    if (game.tier === 1) s.ranked_games += 1;
    if (game.tier === 2) s.elite_games += 1;
    if (p.winner) {
      s.games_won += 1;
      if (game.tier === 1) s.ranked_wins += 1;
      if (game.tier === 2) s.elite_wins += 1;
      s.composite_score = Number(s.composite_score) + 100 + (p.handsWon ?? 0) * 5;
      s.recency_score = Number(s.recency_score) + 25;
    }
    s.updated_at = new Date().toISOString();

    await sb().from('bot_stats_snapshots').upsert(s, { onConflict: 'bot_address' });
    await this.appendRankingEvent({
      botAddress: addr,
      gameId: game.id,
      eventType: p.winner ? 'game_won' : 'game_lost',
      payload: { tableId: game.table_id, tier: game.tier },
    });
  },
};
