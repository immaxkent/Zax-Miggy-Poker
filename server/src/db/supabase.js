import { createClient } from '@supabase/supabase-js';
import config from '../config.js';

let _client = null;

/**
 * Supabase client (service role). Returns null when not configured.
 */
export function getSupabase() {
  const { url, serviceRoleKey } = config.supabase;
  if (!url || !serviceRoleKey) return null;
  if (!_client) {
    _client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}

export function isSupabaseEnabled() {
  return getSupabase() !== null;
}
