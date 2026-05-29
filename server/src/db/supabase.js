import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import config from '../config.js';

let _client = null;

/**
 * Supabase client (service role). Returns null when not configured.
 * Node < 22 has no native WebSocket — pass `ws` for realtime-js init (we use REST only).
 */
export function getSupabase() {
  const { url, serviceRoleKey } = config.supabase;
  if (!url || !serviceRoleKey) return null;
  if (!_client) {
    _client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: ws },
    });
  }
  return _client;
}

export function isSupabaseEnabled() {
  return getSupabase() !== null;
}
