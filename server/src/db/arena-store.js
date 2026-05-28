import config from '../config.js';
import { isSupabaseEnabled } from './supabase.js';
import { memoryArenaStore } from './memory-arena-store.js';
import { supabaseArenaStore } from './supabase-arena-store.js';

function store() {
  return isSupabaseEnabled() ? supabaseArenaStore : memoryArenaStore;
}

export function getArenaStoreBackend() {
  return isSupabaseEnabled() ? 'supabase' : 'memory';
}

export const arenaStore = {
  upsertBot: (args) => store().upsertBot(args),
  getBot: (addr) => store().getBot(addr),
  createGame: (args) => store().createGame(args),
  getGameByTableId: (tableId) => store().getGameByTableId(tableId),
  addParticipant: (args) => store().addParticipant(args),
  listOpenGames: (args) => store().listOpenGames(args),
  listGamesForApi: () => store().listGamesForApi(),
  recordHand: (args) => store().recordHand(args),
  finalizeGame: (args) => store().finalizeGame(args),
  getBotProfile: (addr) => store().getBotProfile(addr),
  getBotHistory: (addr, limit) => store().getBotHistory(addr, limit),
  appendRankingEvent: (args) => store().appendRankingEvent(args),
  saveHistoryExport: (addr, payload) => store().saveHistoryExport(addr, payload),
};

export function isArenaTableId(tableId) {
  return typeof tableId === 'string' && tableId.startsWith('arena-');
}

export function parseArenaGameId(tableId) {
  if (!isArenaTableId(tableId)) return null;
  const raw = tableId.replace('arena-', '');
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
}

export async function initArenaPersistence() {
  const backend = getArenaStoreBackend();
  if (backend === 'supabase') {
    console.log('✅ Arena persistence: Supabase');
  } else if (config.arena.enabled) {
    console.warn('⚠️  AGENTIC_ARENA_ENABLED but Supabase not configured — using in-memory store');
    console.warn('    Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or run migration in Supabase)');
  }
  return backend;
}
