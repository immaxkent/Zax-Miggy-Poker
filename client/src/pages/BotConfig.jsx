import { useState } from 'react';
import { Link } from 'react-router-dom';

const BG = '#090d14';
const G  = '#00e676';

const PRESETS = {
  gto:        { label: 'GTO',        desc: 'Balanced, unexploitable',  color: G },
  aggressive: { label: 'AGGRESSIVE', desc: 'Wide ranges, big bets',    color: '#ff0070' },
  rock:       { label: 'ROCK',       desc: 'Tight, value-only',         color: '#00b4d8' },
  maniac:     { label: 'MANIAC',     desc: 'Any two cards, overbet',    color: '#f59e0b' },
  trappy:     { label: 'TRAPPY',     desc: 'Slow-play monsters',        color: '#a855f7' },
};

const PRESET_DEFAULTS = {
  gto:        { starting_hand_range: 22, positional_tightness: 60, open_raise_size: 50, three_bet_frequency: 40, cbet_frequency: 55, bluff_frequency: 35, bluff_detection: 50, bet_sizing: 50, hand_strength_threshold: 40, stack_depth_adjustment: true },
  aggressive: { starting_hand_range: 35, positional_tightness: 30, open_raise_size: 75, three_bet_frequency: 65, cbet_frequency: 75, bluff_frequency: 60, bluff_detection: 40, bet_sizing: 70, hand_strength_threshold: 25, stack_depth_adjustment: true },
  rock:       { starting_hand_range: 12, positional_tightness: 85, open_raise_size: 40, three_bet_frequency: 15, cbet_frequency: 40, bluff_frequency: 10, bluff_detection: 70, bet_sizing: 35, hand_strength_threshold: 70, stack_depth_adjustment: true },
  maniac:     { starting_hand_range: 65, positional_tightness: 10, open_raise_size: 90, three_bet_frequency: 80, cbet_frequency: 85, bluff_frequency: 80, bluff_detection: 20, bet_sizing: 90, hand_strength_threshold: 10, stack_depth_adjustment: false },
  trappy:     { starting_hand_range: 18, positional_tightness: 50, open_raise_size: 30, three_bet_frequency: 20, cbet_frequency: 30, bluff_frequency: 25, bluff_detection: 60, bet_sizing: 25, hand_strength_threshold: 55, stack_depth_adjustment: true },
};

const SLIDERS = [
  { key: 'starting_hand_range',     label: 'Starting Hand Range',     hint: '% of hands to voluntarily enter pot' },
  { key: 'positional_tightness',    label: 'Positional Tightness',    hint: 'How much tighter to play out-of-position' },
  { key: 'open_raise_size',         label: 'Open-Raise Size',         hint: '0 = min-raise  ·  100 = pot-sized opens' },
  { key: 'three_bet_frequency',     label: '3-Bet Frequency',         hint: 'How often to re-raise a pre-flop opener' },
  { key: 'cbet_frequency',          label: 'C-Bet Frequency',         hint: 'Continuation bet frequency on the flop' },
  { key: 'bluff_frequency',         label: 'Bluff Frequency',         hint: 'General propensity to bluff' },
  { key: 'bluff_detection',         label: 'Bluff Detection',         hint: '0 = trusting  ·  100 = calls down wide' },
  { key: 'bet_sizing',              label: 'Bet Sizing',              hint: '0 = small bets  ·  100 = overbets' },
  { key: 'hand_strength_threshold', label: 'Hand Strength Threshold', hint: 'Min strength needed to continue on danger boards' },
];

function labelFor(v) {
  return v <= 20 ? 'VERY LOW' : v <= 40 ? 'LOW' : v <= 60 ? 'MODERATE' : v <= 80 ? 'HIGH' : 'VERY HIGH';
}

export default function BotConfig() {
  const [preset, setPreset]               = useState('gto');
  const [sliders, setSliders]             = useState({ ...PRESET_DEFAULTS.gto });
  const [priceMin, setPriceMin]           = useState(1);
  const [priceMax, setPriceMax]           = useState(10);
  const [stackDepth, setStackDepth]       = useState(true);
  const [custom, setCustom]               = useState('');
  const [downloaded, setDownloaded]       = useState(false);

  function applyPreset(p) {
    setPreset(p);
    setSliders({ ...PRESET_DEFAULTS[p] });
    setStackDepth(PRESET_DEFAULTS[p].stack_depth_adjustment);
    setDownloaded(false);
  }

  function handleSlider(key, val) {
    setPreset('custom');
    setSliders(s => ({ ...s, [key]: Number(val) }));
    setDownloaded(false);
  }

  function buildConfig() {
    return {
      persona: preset === 'custom' ? 'gto' : preset,
      ...sliders,
      stack_depth_adjustment: stackDepth,
      price_range_min: Number(priceMin) || 0,
      price_range_max: Number(priceMax) || 0,
      custom_instructions: custom.trim(),
    };
  }

  function downloadConfig() {
    const blob = new Blob([JSON.stringify(buildConfig(), null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `bot-${preset}.config.json`; a.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);
  }

  const accent = PRESETS[preset]?.color || G;

  return (
    <div style={{ minHeight: 'calc(100vh - 60px)', background: BG, fontFamily: "'Space Grotesk','Outfit',sans-serif" }}>
      <div style={{ maxWidth: 940, margin: '0 auto', padding: '48px 24px 64px' }}>

        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <div style={{ color: '#334155', fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', marginBottom: 8 }}>// AI BOTS</div>
          <h1 style={{ color: '#fff', fontWeight: 900, fontSize: 32, letterSpacing: '0.04em', textTransform: 'uppercase', lineHeight: 1, margin: '0 0 10px' }}>
            CONFIGURE <span style={{ color: accent }}>YOUR BOT</span>
          </h1>
          <p style={{ color: '#475569', fontSize: 14, lineHeight: 1.6, maxWidth: 560, margin: 0 }}>
            Pick a persona, tweak the sliders, download your <code style={{ color: '#94a3b8' }}>config.json</code>, then{' '}
            <Link to="/activate-agent" style={{ color: accent, textDecoration: 'none', fontWeight: 600 }}>activate your bot →</Link>
          </p>
        </div>

        {/* Persona presets */}
        <div style={{ marginBottom: 36 }}>
          <div style={{ color: '#334155', fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', marginBottom: 12 }}>PERSONA PRESET</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Object.entries(PRESETS).map(([key, { label, desc, color }]) => (
              <button key={key} onClick={() => applyPreset(key)} style={{
                padding: '10px 18px', borderRadius: 8, cursor: 'pointer',
                background: preset === key ? `${color}1a` : 'rgba(255,255,255,0.02)',
                border: `1px solid ${preset === key ? `${color}55` : 'rgba(255,255,255,0.07)'}`,
                color: preset === key ? color : '#64748b',
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                minWidth: 110, transition: 'all 0.15s',
              }}>
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em' }}>{label}</span>
                <span style={{ fontSize: 10, fontWeight: 400, color: preset === key ? color : '#334155', textTransform: 'none', letterSpacing: '0.02em' }}>{desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 28, alignItems: 'start' }}>

          {/* Sliders */}
          <div>
            <div style={{ color: '#334155', fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', marginBottom: 18 }}>STRATEGY SLIDERS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

              {SLIDERS.map(({ key, label, hint }) => (
                <div key={key}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 7 }}>
                    <div>
                      <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{label}</span>
                      <div style={{ color: '#334155', fontSize: 10, marginTop: 1 }}>{hint}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <span style={{ color: accent, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', minWidth: 68, textAlign: 'right' }}>{labelFor(sliders[key])}</span>
                      <span style={{ color: '#475569', fontSize: 10, fontFamily: 'Space Mono,monospace', minWidth: 24, textAlign: 'right' }}>{sliders[key]}</span>
                    </div>
                  </div>
                  <input type="range" min={0} max={100} value={sliders[key]}
                    onChange={e => handleSlider(key, e.target.value)}
                    style={{ width: '100%', height: 3, accentColor: accent, cursor: 'pointer', outline: 'none' }}
                  />
                </div>
              ))}

              {/* Stack depth toggle */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div>
                  <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, marginBottom: 2 }}>Stack Depth Adjustment</div>
                  <div style={{ color: '#334155', fontSize: 10 }}>Tighten range when effective SPR {'<'} 4</div>
                </div>
                <button onClick={() => { setStackDepth(v => !v); setPreset('custom'); setDownloaded(false); }}
                  style={{ width: 48, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer', background: stackDepth ? accent : '#1e3050', transition: 'background 0.2s', position: 'relative', flexShrink: 0 }}>
                  <div style={{ position: 'absolute', top: 3, left: stackDepth ? 25 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.5)' }} />
                </button>
              </div>
            </div>
          </div>

          {/* Right panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Price range */}
            <div style={{ background: '#0d1520', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 18 }}>
              <div style={{ color: '#334155', fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', marginBottom: 14 }}>AUTO-JOIN PRICE RANGE (USDC)</div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                {[['MIN', priceMin, setPriceMin], ['MAX', priceMax, setPriceMax]].map(([lbl, val, setter]) => (
                  <div key={lbl} style={{ flex: 1 }}>
                    <div style={{ color: '#475569', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 6 }}>{lbl}</div>
                    <input type="number" value={val} onChange={e => { setter(e.target.value); setDownloaded(false); }}
                      style={{ width: '100%', padding: '9px 10px', borderRadius: 7, background: '#060d14', border: '1px solid rgba(255,255,255,0.08)', color: '#e2e8f0', fontSize: 13, outline: 'none', fontFamily: 'Space Mono,monospace', boxSizing: 'border-box' }} />
                  </div>
                ))}
              </div>
              <div style={{ color: '#334155', fontSize: 10 }}>Set MAX to 0 for no upper limit.</div>
            </div>

            {/* Custom instructions */}
            <div style={{ background: '#0d1520', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 18 }}>
              <div style={{ color: '#334155', fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', marginBottom: 10 }}>CUSTOM INSTRUCTIONS</div>
              <textarea value={custom} onChange={e => { setCustom(e.target.value); setDownloaded(false); }}
                placeholder={"e.g. Always raise on the river with nut flush.\nTighten up with fewer than 3 players."}
                rows={5} style={{
                  width: '100%', padding: '9px 10px', borderRadius: 7, boxSizing: 'border-box',
                  background: '#060d14', border: '1px solid rgba(255,255,255,0.08)',
                  color: '#e2e8f0', fontSize: 11, resize: 'vertical', outline: 'none',
                  fontFamily: 'Space Mono,monospace', lineHeight: 1.5,
                }} />
              <div style={{ color: '#334155', fontSize: 10, marginTop: 5 }}>Appended verbatim to Claude's system prompt.</div>
            </div>

            {/* Config preview */}
            <div style={{ background: '#0d1520', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 14, maxHeight: 160, overflow: 'auto' }}>
              <div style={{ color: '#334155', fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', marginBottom: 8 }}>PREVIEW</div>
              <pre style={{ color: '#475569', fontSize: 9, margin: 0, fontFamily: 'Space Mono,monospace', lineHeight: 1.5 }}>
                {JSON.stringify(buildConfig(), null, 2)}
              </pre>
            </div>

            {/* Download */}
            <button onClick={downloadConfig} style={{
              padding: '13px', borderRadius: 8, border: downloaded ? `1px solid ${G}40` : 'none',
              background: downloaded ? `${G}15` : `linear-gradient(135deg, ${accent}, ${accent === G ? '#00b4d8' : '#6d28d9'})`,
              color: downloaded ? G : '#000', fontSize: 13, fontWeight: 800, letterSpacing: '0.12em',
              cursor: 'pointer', transition: 'all 0.2s',
            }}>
              {downloaded ? '✓ DOWNLOADED' : '↓ DOWNLOAD config.json'}
            </button>

            {downloaded && (
              <Link to="/activate-agent" style={{
                display: 'block', padding: '13px', borderRadius: 8, textDecoration: 'none', textAlign: 'center',
                background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)',
                color: '#a855f7', fontSize: 13, fontWeight: 700, letterSpacing: '0.12em',
              }}>
                ACTIVATE BOT →
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
