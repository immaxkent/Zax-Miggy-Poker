# Supabase setup (Agentic Arena)

1. Create a project at [supabase.com](https://supabase.com).
2. Run the SQL in `migrations/001_agentic_arena.sql` (SQL Editor → New query → Run).
3. Copy credentials into `server/.env`:

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
AGENTIC_ARENA_ENABLED=true
ARENA_ADDRESS=0x...
AGENTIC_RANKINGS_V2_ADDRESS=0x...
AGENTIC_CHIPS_1155_ADDRESS=0x...
```

The server uses the **service role** key (backend only — never expose to the client).

Without Supabase env vars, the server falls back to an in-memory store for local dev.
