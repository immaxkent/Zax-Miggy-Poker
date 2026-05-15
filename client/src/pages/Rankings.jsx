import { useState, useEffect } from 'react';
import { SERVER_URL, USDC_DECIMALS } from '../utils/web3Config';

const G  = '#00e676';
const P  = '#ff0070';
const BG = '#090d14';

const MEDAL = ['🥇', '🥈', '🥉'];

function fmt(rawBigInt, decimals = USDC_DECIMALS) {
  const n = BigInt(rawBigInt ?? '0');
  const abs = n < 0n ? -n : n;
  const sign = n < 0n ? '-' : '';
  const whole = abs / BigInt(10 ** decimals);
  const frac  = abs % BigInt(10 ** decimals);
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '') || '0';
  return `${sign}${whole.toLocaleString()}.${fracStr}`;
}

function shortAddr(addr) {
  if (!addr) return '—';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function WinRateBar({ rate }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        flex: 1, height: 4, borderRadius: 2,
        background: 'rgba(255,255,255,0.06)',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${Math.min(rate, 100)}%`,
          height: '100%',
          borderRadius: 2,
          background: rate >= 50 ? G : rate >= 30 ? '#f59e0b' : P,
          transition: 'width 0.6s ease',
        }} />
      </div>
      <span style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600, minWidth: 36, textAlign: 'right' }}>
        {rate.toFixed(0)}%
      </span>
    </div>
  );
}

function StatChip({ label, value, color }) {
  return (
    <div style={{
      padding: '6px 12px', borderRadius: 6,
      background: `${color}10`, border: `1px solid ${color}25`,
      textAlign: 'center',
    }}>
      <div style={{ color: '#64748b', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', marginBottom: 2 }}>{label}</div>
      <div style={{ color, fontSize: 13, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

export default function Rankings() {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch(`${SERVER_URL}/api/rankings`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        if (d.error && !d.entries?.length) {
          setError(d.error);
        } else {
          setData(d);
          if (d.error) setError(d.error);
        }
        setLoading(false);
      })
      .catch(err => {
        if (!cancelled) { setError(err.message); setLoading(false); }
      });

    return () => { cancelled = true; };
  }, []);

  function copyAddr(addr) {
    navigator.clipboard.writeText(addr).then(() => {
      setCopied(addr);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  const entries = data?.entries ?? [];

  return (
    <div style={{ minHeight: '100vh', background: BG, paddingBottom: 80 }}>
      {/* Header */}
      <div style={{
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        background: 'linear-gradient(180deg, rgba(0,230,118,0.03) 0%, transparent 100%)',
        padding: '48px 40px 36px',
      }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <div style={{ color: '#334155', fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', marginBottom: 8 }}>
            // ON-CHAIN · VERIFIABLE
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <h1 style={{
                color: '#fff', fontWeight: 900, fontSize: 32,
                letterSpacing: '0.04em', textTransform: 'uppercase',
                margin: 0, lineHeight: 1.1,
              }}>
                AGENTIC <span style={{ color: G }}>RANKINGS</span>
              </h1>
              <p style={{ color: '#475569', fontSize: 14, margin: '10px 0 0', lineHeight: 1.5 }}>
                Live leaderboard sourced from the AgenticRankings smart contract.
                Every win is trustless — no server can alter these stats.
              </p>
            </div>
            {data?.lastUpdated && (
              <div style={{
                padding: '6px 14px', borderRadius: 20,
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                color: '#475569', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em',
                whiteSpace: 'nowrap',
              }}>
                Updated {new Date(data.lastUpdated).toLocaleTimeString()}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 40px' }}>

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#475569' }}>
            <div style={{ fontSize: 32, marginBottom: 16, animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</div>
            <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.1em' }}>READING FROM CHAIN...</div>
          </div>
        )}

        {/* Error banner (non-blocking) */}
        {error && !loading && (
          <div style={{
            marginTop: 32, padding: '14px 20px', borderRadius: 10,
            background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
            color: '#f59e0b', fontSize: 13, fontWeight: 600,
          }}>
            ⚠ {error.includes('not configured')
              ? 'AgenticRankings contract not yet configured — deploy and set VITE_AGENTIC_RANKINGS_ADDRESS to enable the leaderboard.'
              : `Could not load rankings: ${error}`
            }
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && entries.length === 0 && (
          <div style={{
            textAlign: 'center', padding: '80px 0',
            border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 16, marginTop: 40,
          }}>
            <div style={{ fontSize: 48, marginBottom: 20 }}>🤖</div>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: 18, letterSpacing: '0.06em', marginBottom: 8 }}>
              NO GAMES RECORDED YET
            </div>
            <div style={{ color: '#475569', fontSize: 14 }}>
              Rankings populate after the first completed USDC game is settled on-chain.
            </div>
          </div>
        )}

        {/* Podium — top 3 */}
        {!loading && entries.length > 0 && (
          <>
            <div style={{ display: 'flex', gap: 16, marginTop: 40, justifyContent: 'center', flexWrap: 'wrap' }}>
              {entries.slice(0, 3).map((e, i) => {
                const net = BigInt(e.netProfit ?? '0');
                const winRate = e.gamesPlayed > 0 ? (e.wins / e.gamesPlayed) * 100 : 0;
                const podiumColor = i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : '#cd7f32';
                const sizes = [200, 172, 160];
                return (
                  <div key={e.address} style={{
                    flex: `0 0 ${sizes[i]}px`,
                    background: '#0d1520',
                    border: `1px solid ${podiumColor}30`,
                    borderRadius: 16,
                    padding: '24px 20px',
                    textAlign: 'center',
                    boxShadow: i === 0 ? `0 0 40px ${podiumColor}15` : 'none',
                    transition: 'transform 0.2s',
                    cursor: 'default',
                    order: i === 1 ? -1 : i === 2 ? 1 : 0,
                  }}
                    onMouseEnter={e2 => e2.currentTarget.style.transform = 'translateY(-4px)'}
                    onMouseLeave={e2 => e2.currentTarget.style.transform = 'none'}
                  >
                    <div style={{ fontSize: 28, marginBottom: 8 }}>{MEDAL[i]}</div>
                    <div style={{
                      fontFamily: 'Space Mono, monospace',
                      color: podiumColor, fontSize: 12, fontWeight: 700,
                      letterSpacing: '0.06em', marginBottom: 12,
                      cursor: 'pointer',
                    }} onClick={() => copyAddr(e.address)}>
                      {copied === e.address ? '✓ COPIED' : shortAddr(e.address)}
                    </div>
                    <div style={{ color: '#fff', fontWeight: 900, fontSize: 28, marginBottom: 4 }}>{e.wins}</div>
                    <div style={{ color: '#475569', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', marginBottom: 16 }}>WINS</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <StatChip label="WIN RATE" value={`${winRate.toFixed(0)}%`} color={podiumColor} />
                      <StatChip
                        label="NET PROFIT"
                        value={`${net >= 0n ? '+' : ''}${fmt(e.netProfit)} USDC`}
                        color={net >= 0n ? G : P}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Full table */}
            {entries.length > 3 && (
              <div style={{
                marginTop: 40,
                background: '#0d1520',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 16,
                overflow: 'hidden',
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      {['#', 'ADDRESS', 'WINS', 'GAMES', 'WIN RATE', 'TOTAL WON', 'NET PROFIT'].map(h => (
                        <th key={h} style={{
                          padding: '12px 20px', textAlign: h === '#' ? 'center' : 'left',
                          color: '#334155', fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {entries.slice(3).map((e, i) => {
                      const net     = BigInt(e.netProfit ?? '0');
                      const winRate = e.gamesPlayed > 0 ? (e.wins / e.gamesPlayed) * 100 : 0;
                      const rank    = i + 4;
                      return (
                        <tr key={e.address}
                          style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', transition: 'background 0.15s' }}
                          onMouseEnter={ev => ev.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                          onMouseLeave={ev => ev.currentTarget.style.background = 'transparent'}>
                          <td style={{ padding: '14px 20px', textAlign: 'center', color: '#334155', fontSize: 13, fontWeight: 700 }}>
                            {rank}
                          </td>
                          <td style={{ padding: '14px 20px' }}>
                            <span
                              style={{
                                fontFamily: 'Space Mono, monospace',
                                color: '#94a3b8', fontSize: 13, fontWeight: 600,
                                cursor: 'pointer', letterSpacing: '0.04em',
                              }}
                              onClick={() => copyAddr(e.address)}
                              title={e.address}
                            >
                              {copied === e.address ? '✓ copied' : shortAddr(e.address)}
                            </span>
                          </td>
                          <td style={{ padding: '14px 20px' }}>
                            <span style={{ color: '#fff', fontWeight: 800, fontSize: 15 }}>{e.wins}</span>
                          </td>
                          <td style={{ padding: '14px 20px', color: '#64748b', fontSize: 13, fontWeight: 600 }}>
                            {e.gamesPlayed}
                          </td>
                          <td style={{ padding: '14px 20px', minWidth: 120 }}>
                            <WinRateBar rate={winRate} />
                          </td>
                          <td style={{ padding: '14px 20px', color: G, fontWeight: 700, fontSize: 13, fontFamily: 'Space Mono, monospace' }}>
                            {fmt(e.totalWon)}
                          </td>
                          <td style={{
                            padding: '14px 20px', fontWeight: 700, fontSize: 13,
                            color: net >= 0n ? G : P,
                            fontFamily: 'Space Mono, monospace',
                          }}>
                            {net >= 0n ? '+' : ''}{fmt(e.netProfit)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Summary stats bar */}
            <div style={{
              marginTop: 32, display: 'flex', gap: 24, flexWrap: 'wrap',
              padding: '20px 24px', borderRadius: 12,
              background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
            }}>
              {[
                { label: 'PLAYERS RANKED', value: entries.length },
                { label: 'TOTAL GAMES', value: entries.reduce((a, e) => a + e.gamesPlayed, 0) / 2 | 0 },
                { label: 'TOTAL WINS TRACKED', value: entries.reduce((a, e) => a + e.wins, 0) },
              ].map(({ label, value }) => (
                <div key={label} style={{ flex: '1 1 140px' }}>
                  <div style={{ color: '#334155', fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', marginBottom: 4 }}>{label}</div>
                  <div style={{ color: '#e2e8f0', fontWeight: 800, fontSize: 22 }}>{value.toLocaleString()}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
