import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { SERVER_URL } from '../utils/web3Config';

const G = '#00e676';
const VIOLET = '#a855f7';
const BG = '#090d14';

const METRIC_CARDS = [
  { key: 'assassinScore', label: 'Assassin', hint: 'Beats stronger bots', color: '#ef4444' },
  { key: 'sociopathScore', label: 'Sociopath', hint: 'Farm weaker pools (capped)', color: '#f59e0b' },
  { key: 'consistencyScore', label: 'Consistency', hint: 'Low variance results', color: '#00b4d8' },
  { key: 'recencyScore', label: 'Recency', hint: 'Recent form', color: G },
];

function shortAddr(a) {
  if (!a) return '—';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default function BotProfile() {
  const { botAddress } = useParams();
  const addr = botAddress?.toLowerCase();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!addr) return;
    setLoading(true);
    fetch(`${SERVER_URL}/api/arena/bots/${addr}/profile`)
      .then(r => {
        if (!r.ok) throw new Error('Profile not found');
        return r.json();
      })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [addr]);

  const m = data?.metrics;

  return (
    <div style={{ minHeight: 'calc(100vh - 60px)', background: BG, padding: '32px 24px 64px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <Link to="/arena" style={{ color: '#64748b', fontSize: 12, textDecoration: 'none' }}>← Arena lobby</Link>

        <div style={{ marginTop: 20, marginBottom: 28 }}>
          <div style={{ color: '#334155', fontSize: 11, fontWeight: 700, letterSpacing: '0.2em' }}>// BOT PROFILE</div>
          <h1 style={{ color: '#fff', fontWeight: 900, fontSize: 24, marginTop: 8, fontFamily: 'Space Mono, monospace' }}>
            {shortAddr(addr)}
          </h1>
          {data?.bot?.owner_address && (
            <p style={{ color: '#64748b', fontSize: 12, marginTop: 6 }}>
              Owner {shortAddr(data.bot.owner_address)}
            </p>
          )}
        </div>

        {loading && <p style={{ color: '#64748b' }}>Loading…</p>}
        {error && (
          <div style={{ padding: 16, borderRadius: 8, background: 'rgba(239,68,68,0.08)', color: '#f87171' }}>
            {error}
            <p style={{ marginTop: 8, fontSize: 13, color: '#94a3b8' }}>
              Play arena games or register the bot via <Link to="/bots" style={{ color: G }}>Bot Config</Link>.
            </p>
          </div>
        )}

        {m && (
          <>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 28,
            }}>
              {[
                { label: 'Games', value: m.gamesPlayed },
                { label: 'Wins', value: m.gamesWon },
                { label: 'Hands won', value: m.handsWon },
                { label: 'Rank', value: m.rankPosition ?? '—' },
              ].map(({ label, value }) => (
                <div key={label} style={{
                  padding: 16, borderRadius: 10, background: '#0d1520',
                  border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center',
                }}>
                  <div style={{ color: '#fff', fontSize: 22, fontWeight: 800 }}>{value}</div>
                  <div style={{ color: '#475569', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', marginTop: 4 }}>{label}</div>
                </div>
              ))}
            </div>

            <div style={{ marginBottom: 12, color: VIOLET, fontSize: 11, fontWeight: 700, letterSpacing: '0.16em' }}>
              COMPONENT SCORES
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 32 }}>
              {METRIC_CARDS.map(({ key, label, hint, color }) => (
                <div key={key} style={{
                  padding: 18, borderRadius: 12, background: '#0d1520',
                  border: `1px solid ${color}30`,
                }}>
                  <div style={{ color, fontSize: 11, fontWeight: 800, letterSpacing: '0.1em' }}>{label.toUpperCase()}</div>
                  <div style={{ color: '#fff', fontSize: 28, fontWeight: 800, margin: '8px 0' }}>
                    {m[key] ?? 0}
                  </div>
                  <div style={{ color: '#64748b', fontSize: 11 }}>{hint}</div>
                </div>
              ))}
            </div>

            <div style={{
              padding: 16, borderRadius: 10, background: `${G}10`, border: `1px solid ${G}30`,
              marginBottom: 28,
            }}>
              <span style={{ color: '#64748b', fontSize: 11, fontWeight: 700 }}>COMPOSITE </span>
              <span style={{ color: G, fontSize: 24, fontWeight: 900 }}>{m.compositeScore ?? 0}</span>
              <span style={{ color: '#64748b', fontSize: 12, marginLeft: 8 }}>chips net {m.chipsNet ?? 0}</span>
            </div>
          </>
        )}

        {data?.history?.length > 0 && (
          <>
            <div style={{ color: '#334155', fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', marginBottom: 12 }}>
              RECENT GAMES
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {data.history.map((h, i) => (
                <div key={i} style={{
                  padding: '12px 16px', borderRadius: 8, background: '#0d1520',
                  border: '1px solid rgba(255,255,255,0.05)',
                  display: 'flex', justifyContent: 'space-between', fontSize: 13,
                }}>
                  <span style={{ color: '#94a3b8' }}>{h.table_id || h.game_id}</span>
                  <span style={{ color: h.is_winner ? G : '#64748b' }}>
                    {h.is_winner ? 'WIN' : `#${h.placement ?? '—'}`} · {h.chips_end ?? '—'} chips
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
