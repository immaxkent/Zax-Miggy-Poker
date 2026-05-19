import { useState, useEffect, useRef } from 'react';
import { ethers } from 'ethers';
import { Link } from 'react-router-dom';
import { SERVER_URL, SERVER_API_KEY } from '../utils/web3Config';

const BG     = '#090d14';
const G      = '#00e676';
const VIOLET = '#a855f7';
const P      = '#ff0070';

const PRESETS = {
  gto:        { label: 'GTO',        desc: 'Balanced, unexploitable',  color: G },
  aggressive: { label: 'AGGRESSIVE', desc: 'Wide ranges, big bets',    color: P },
  rock:       { label: 'ROCK',       desc: 'Tight, value-only',         color: '#00b4d8' },
  maniac:     { label: 'MANIAC',     desc: 'Any two cards, overbet',    color: '#f59e0b' },
  trappy:     { label: 'TRAPPY',     desc: 'Slow-play monsters',        color: VIOLET },
};

const PRESET_DEFAULTS = {
  gto:        { starting_hand_range: 22, positional_tightness: 60, open_raise_size: 50, three_bet_frequency: 40, cbet_frequency: 55, bluff_frequency: 35, bluff_detection: 50, bet_sizing: 50, hand_strength_threshold: 40 },
  aggressive: { starting_hand_range: 35, positional_tightness: 30, open_raise_size: 75, three_bet_frequency: 65, cbet_frequency: 75, bluff_frequency: 60, bluff_detection: 40, bet_sizing: 70, hand_strength_threshold: 25 },
  rock:       { starting_hand_range: 12, positional_tightness: 85, open_raise_size: 40, three_bet_frequency: 15, cbet_frequency: 40, bluff_frequency: 10, bluff_detection: 70, bet_sizing: 35, hand_strength_threshold: 70 },
  maniac:     { starting_hand_range: 65, positional_tightness: 10, open_raise_size: 90, three_bet_frequency: 80, cbet_frequency: 85, bluff_frequency: 80, bluff_detection: 20, bet_sizing: 90, hand_strength_threshold: 10 },
  trappy:     { starting_hand_range: 18, positional_tightness: 50, open_raise_size: 30, three_bet_frequency: 20, cbet_frequency: 30, bluff_frequency: 25, bluff_detection: 60, bet_sizing: 25, hand_strength_threshold: 55 },
};

const SLIDERS = [
  { key: 'starting_hand_range',     label: 'Starting Hand Range',     hint: '% of hands to voluntarily enter pot' },
  { key: 'positional_tightness',    label: 'Positional Tightness',    hint: 'How much tighter to play out-of-position' },
  { key: 'open_raise_size',         label: 'Open-Raise Size',         hint: '0 = min-raise · 100 = pot-sized opens' },
  { key: 'three_bet_frequency',     label: '3-Bet Frequency',         hint: 'How often to re-raise a pre-flop opener' },
  { key: 'cbet_frequency',          label: 'C-Bet Frequency',         hint: 'Continuation bet frequency on the flop' },
  { key: 'bluff_frequency',         label: 'Bluff Frequency',         hint: 'General propensity to bluff' },
  { key: 'bluff_detection',         label: 'Bluff Detection',         hint: '0 = trusting · 100 = calls down wide' },
  { key: 'bet_sizing',              label: 'Bet Sizing',              hint: '0 = small bets · 100 = overbets' },
  { key: 'hand_strength_threshold', label: 'Hand Strength Threshold', hint: 'Min strength to continue on danger boards' },
];

function sliderLabel(v) {
  return v <= 20 ? 'VERY LOW' : v <= 40 ? 'LOW' : v <= 60 ? 'MODERATE' : v <= 80 ? 'HIGH' : 'VERY HIGH';
}

function StepHeader({ num, title, done, active }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 800, letterSpacing: '0.05em', flexShrink: 0,
        background: done ? G : active ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${done ? G : active ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)'}`,
        color: done ? '#000' : active ? '#e2e8f0' : '#1e3050',
        transition: 'all 0.2s',
      }}>
        {done ? '✓' : num}
      </div>
      <div style={{
        color: done ? G : active ? '#e2e8f0' : '#1e3050',
        fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase',
        transition: 'color 0.2s',
      }}>
        {title}
      </div>
    </div>
  );
}

function InputField({ type = 'text', value, onChange, placeholder, suffix, style = {} }) {
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        style={{
          width: '100%', padding: suffix ? '11px 44px 11px 14px' : '11px 14px',
          borderRadius: 8, boxSizing: 'border-box',
          background: '#060d14', border: '1px solid rgba(255,255,255,0.08)',
          color: '#e2e8f0', fontSize: 13, outline: 'none',
          fontFamily: 'Space Mono,monospace', ...style,
        }}
      />
      {suffix}
    </div>
  );
}

function DropZone({ file, onFile, hint }) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);

  function readFile(f) {
    const reader = new FileReader();
    reader.onload = ev => onFile(f.name, ev.target.result);
    reader.readAsText(f);
  }

  return (
    <div
      onClick={() => inputRef.current.click()}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) readFile(f); }}
      style={{
        padding: '20px', borderRadius: 10, cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s',
        background: drag ? `${VIOLET}10` : file ? `${G}08` : 'rgba(255,255,255,0.02)',
        border: `2px dashed ${drag ? VIOLET : file ? G : 'rgba(255,255,255,0.12)'}`,
      }}>
      <input ref={inputRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
        onChange={e => { if (e.target.files[0]) readFile(e.target.files[0]); }} />
      {file ? (
        <div style={{ color: G, fontSize: 13, fontWeight: 600 }}>
          ✓ {file}
          <div style={{ color: '#334155', fontSize: 11, marginTop: 3, fontWeight: 400 }}>Click or drop to replace</div>
        </div>
      ) : (
        <div style={{ color: '#334155', fontSize: 13 }}>{hint || 'Drop file here or click to browse'}</div>
      )}
    </div>
  );
}

export default function BotWizard({ token, address }) {
  // ── Step 1 — API key ──
  const [anthropicKey, setAnthropicKey] = useState('');
  const [showApiKey, setShowApiKey]     = useState(false);

  // ── Step 2 — Wallet ──
  const [walletMode, setWalletMode]         = useState('generate'); // 'generate' | 'upload'
  const [password, setPassword]             = useState('');
  const [showPw, setShowPw]                 = useState(false);
  const [generating, setGenerating]         = useState(false);
  const [encryptProgress, setEncryptProgress] = useState(null); // 0-100 while encrypting
  const [genError, setGenError]             = useState(null);
  const [genWallet, setGenWallet]           = useState(null); // { address, keystoreJson }
  const [keystoreName, setKeystoreName]     = useState(null);
  const [uploadKeystore, setUploadKeystore] = useState(null);
  const [uploadAddress, setUploadAddress]   = useState(null);
  const [uploadError, setUploadError]       = useState(null);
  const [keystoreDownloaded, setKeystoreDownloaded] = useState(false);

  // ── Step 3 — Strategy ──
  const [preset, setPreset]         = useState('gto');
  const [sliders, setSliders]       = useState({ ...PRESET_DEFAULTS.gto });
  const [stackDepth, setStackDepth] = useState(true);
  const [depositUsdc, setDepositUsdc]     = useState(1);
  const [maxBuyIn, setMaxBuyIn]           = useState(1);
  const [blindInterval, setBlindInterval] = useState(10);
  const [customInstructions, setCustomInstructions] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ── Step 4 — Game ──
  const [selectedGameId, setSelectedGameId] = useState(null);
  const [manualGameId, setManualGameId]     = useState('');
  const [liveGames, setLiveGames]           = useState([]);

  // ── Activation ──
  const [activating, setActivating]     = useState(false);
  const [activateError, setActivateError] = useState(null);
  const [agentStatus, setAgentStatus]   = useState(null);
  const pollRef = useRef(null);

  // Poll agent status
  useEffect(() => {
    if (!token) return;
    async function poll() {
      try {
        const res = await fetch(`${SERVER_URL}/agent/status`, {
          headers: { 'X-Poker-Key': SERVER_API_KEY, 'Authorization': `Bearer ${token}` },
        });
        const data = await res.json();
        setAgentStatus(data?.status && data.status !== 'none' ? data : null);
      } catch { /* ignore */ }
    }
    poll();
    pollRef.current = setInterval(poll, 4000);
    return () => clearInterval(pollRef.current);
  }, [token]);

  // Fetch live games
  useEffect(() => {
    async function fetchGames() {
      try {
        const res = await fetch(`${SERVER_URL}/api/games`);
        if (res.ok) setLiveGames(await res.json());
      } catch { /* ignore */ }
    }
    fetchGames();
    const id = setInterval(fetchGames, 8000);
    return () => clearInterval(id);
  }, []);

  // ── Wallet helpers ──
  async function generateWallet() {
    if (!password || generating) return;
    setGenerating(true);
    setEncryptProgress(0);
    setGenError(null);
    try {
      const wallet = ethers.Wallet.createRandom();
      // ethers v6: second arg must be a ProgressCallback function, not an options object
      const keystore = await wallet.encrypt(password, (progress) => {
        setEncryptProgress(Math.round(progress * 100));
      });
      setGenWallet({ address: wallet.address, keystoreJson: keystore });
      setKeystoreDownloaded(false);
    } catch (e) {
      setGenError(e.message || 'Wallet generation failed');
    }
    setEncryptProgress(null);
    setGenerating(false);
  }

  function downloadKeystore() {
    if (!genWallet) return;
    const blob = new Blob([genWallet.keystoreJson], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `bot-${genWallet.address.slice(0, 10).toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setKeystoreDownloaded(true);
  }

  function handleUploadKeystore(name, text) {
    setUploadError(null);
    setUploadAddress(null);
    try {
      const parsed = JSON.parse(text);
      if (!parsed.version || !parsed.crypto) throw new Error('Not a valid EIP-55 keystore');
      setUploadKeystore(text);
      setKeystoreName(name);
      setUploadAddress(parsed.address ? '0x' + parsed.address.replace(/^0x/i, '') : null);
    } catch (e) {
      setUploadError(e.message || 'Invalid keystore file');
    }
  }

  function applyPreset(p) {
    setPreset(p);
    setSliders({ ...PRESET_DEFAULTS[p] });
    setStackDepth(true);
  }

  // ── Derived state ──
  const effectiveKeystoreJson = walletMode === 'generate' ? genWallet?.keystoreJson : uploadKeystore;
  const effectiveAddress      = walletMode === 'generate' ? genWallet?.address : uploadAddress;
  const effectiveGameId       = selectedGameId ?? (manualGameId.trim() ? Number(manualGameId.trim()) : null);

  const step1Done = true; // API key is optional
  const step2Done = !!effectiveKeystoreJson && !!password;
  const step3Done = step2Done;
  const canCreate = step2Done && !activating && agentStatus?.status !== 'running';

  function buildConfig() {
    return {
      persona: preset === 'custom' ? 'gto' : preset,
      ...sliders,
      stack_depth_adjustment: stackDepth,
      deposit_usdc:     Number(depositUsdc)     || 1,
      max_buy_in_usdc:  Number(maxBuyIn)        || 1,
      blind_interval:   Number(blindInterval)   || 10,
      custom_instructions: customInstructions.trim() || undefined,
    };
  }

  async function handleCreateBot() {
    if (!canCreate) return;
    setActivateError(null);
    setActivating(true);
    try {
      const body = {
        keystoreJson:    effectiveKeystoreJson,
        keystorePassword: password,
        config:          buildConfig(),
        gameId:          effectiveGameId ?? 0,
        botAddress:      effectiveAddress || null,
        anthropicApiKey: anthropicKey.trim() || undefined,
      };
      const res = await fetch(`${SERVER_URL}/agent/activate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Poker-Key': SERVER_API_KEY,
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Activation failed');
    } catch (e) {
      setActivateError(e.message);
    }
    setActivating(false);
  }

  async function handleStop() {
    try {
      await fetch(`${SERVER_URL}/agent`, {
        method: 'DELETE',
        headers: { 'X-Poker-Key': SERVER_API_KEY, 'Authorization': `Bearer ${token}` },
      });
      setAgentStatus(null);
    } catch { /* ignore */ }
  }

  const isRunning = agentStatus?.status === 'running';
  const accent = PRESETS[preset]?.color || G;

  // ── Running panel ──
  if (isRunning) {
    return (
      <div style={{ minHeight: 'calc(100vh - 60px)', background: BG, fontFamily: "'Space Grotesk','Outfit',sans-serif" }}>
        <div style={{ maxWidth: 680, margin: '0 auto', padding: '48px 24px 64px' }}>
          <div style={{ marginBottom: 36 }}>
            <div style={{ color: '#334155', fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', marginBottom: 8 }}>// AI BOTS</div>
            <h1 style={{ color: '#fff', fontWeight: 900, fontSize: 28, letterSpacing: '0.04em', textTransform: 'uppercase', lineHeight: 1, margin: '0 0 8px' }}>
              BOT <span style={{ color: G }}>ACTIVE</span>
            </h1>
          </div>

          <div style={{ background: '#0d1520', border: `1px solid ${G}30`, borderRadius: 14, padding: 24, marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: G, boxShadow: `0 0 8px ${G}` }} />
                  <span style={{ color: G, fontSize: 11, fontWeight: 700, letterSpacing: '0.14em' }}>RUNNING</span>
                </div>
                {agentStatus.botAddress && (
                  <div style={{ color: '#475569', fontSize: 12, fontFamily: 'Space Mono,monospace' }}>
                    Bot: {agentStatus.botAddress.slice(0, 8)}…{agentStatus.botAddress.slice(-4)}
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: '#334155', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', marginBottom: 4 }}>GAME ID</div>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 16, fontFamily: 'Space Mono,monospace' }}>
                  {agentStatus.gameId != null ? `#${agentStatus.gameId}` : 'auto'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {agentStatus.gameId != null && (
                <Link to={`/spectate/${agentStatus.gameId}`} style={{
                  flex: 1, padding: '11px', borderRadius: 8, textDecoration: 'none', textAlign: 'center',
                  background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.3)',
                  color: VIOLET, fontSize: 13, fontWeight: 700, letterSpacing: '0.1em',
                }}>
                  WATCH GAME
                </Link>
              )}
              <button onClick={handleStop} style={{
                flex: agentStatus.gameId != null ? '0 0 auto' : 1,
                padding: '11px 20px', borderRadius: 8, border: `1px solid ${P}40`,
                background: `${P}10`, color: P, fontSize: 13, fontWeight: 700, letterSpacing: '0.1em',
                cursor: 'pointer',
              }}>
                STOP BOT
              </button>
            </div>
          </div>

          <div style={{ background: '#060d14', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 16 }}>
            <div style={{ color: '#334155', fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', marginBottom: 10 }}>AGENT LOGS</div>
            <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {(agentStatus.output || []).slice(-40).map((entry, i) => (
                <div key={i} style={{ fontSize: 11, fontFamily: 'Space Mono,monospace', color: entry.line?.startsWith('[ERR]') ? '#f87171' : '#475569', lineHeight: 1.5 }}>
                  <span style={{ color: '#1e3050', marginRight: 8 }}>{new Date(entry.ts).toLocaleTimeString()}</span>
                  {entry.line}
                </div>
              ))}
              {(!agentStatus.output || agentStatus.output.length === 0) && (
                <div style={{ color: '#1e3050', fontSize: 11, fontFamily: 'Space Mono,monospace' }}>Waiting for output…</div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Setup wizard ──
  return (
    <div style={{ minHeight: 'calc(100vh - 60px)', background: BG, fontFamily: "'Space Grotesk','Outfit',sans-serif" }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '48px 24px 80px' }}>

        {/* Header */}
        <div style={{ marginBottom: 44 }}>
          <div style={{ color: '#334155', fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', marginBottom: 8 }}>// AI BOTS</div>
          <h1 style={{ color: '#fff', fontWeight: 900, fontSize: 32, letterSpacing: '0.04em', textTransform: 'uppercase', lineHeight: 1, margin: '0 0 10px' }}>
            CREATE <span style={{ color: G }}>YOUR BOT</span>
          </h1>
          <p style={{ color: '#475569', fontSize: 14, lineHeight: 1.6, maxWidth: 520, margin: 0 }}>
            Configure your AI poker bot. No files to download — it launches directly from your browser.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 32, alignItems: 'start' }}>

          {/* ── Left column ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

            {/* Step 1 — API Key */}
            <div style={{ background: '#0d1520', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: 24 }}>
              <StepHeader num="01" title="Anthropic API Key (optional)" done={false} active={true} />
              <InputField
                type={showApiKey ? 'text' : 'password'}
                value={anthropicKey}
                onChange={e => setAnthropicKey(e.target.value)}
                placeholder="sk-ant-…"
                suffix={
                  <button onClick={() => setShowApiKey(v => !v)} style={{
                    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 13,
                  }}>{showApiKey ? '🙈' : '👁'}</button>
                }
              />
              <div style={{ color: '#334155', fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
                Powers Claude-based decisions. Without a key, the bot plays using weighted-random strategy based on its persona.
              </div>
            </div>

            {/* Step 2 — Wallet */}
            <div style={{ background: '#0d1520', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: 24 }}>
              <StepHeader num="02" title="Bot Wallet" done={step2Done} active={true} />

              {/* Mode tabs */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 4 }}>
                {[['generate', 'Generate new'], ['upload', 'Upload existing']].map(([mode, label]) => (
                  <button key={mode} onClick={() => setWalletMode(mode)} style={{
                    flex: 1, padding: '8px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: walletMode === mode ? '#1e3050' : 'transparent',
                    color: walletMode === mode ? '#e2e8f0' : '#475569',
                    fontSize: 12, fontWeight: 600, fontFamily: 'inherit', letterSpacing: '0.05em',
                    transition: 'all 0.15s',
                  }}>{label}</button>
                ))}
              </div>

              {walletMode === 'generate' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <div style={{ color: '#334155', fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', marginBottom: 8 }}>WALLET PASSWORD</div>
                    <InputField
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      onChange={e => { setPassword(e.target.value); setGenWallet(null); }}
                      placeholder="Choose a strong password"
                      suffix={
                        <button onClick={() => setShowPw(v => !v)} style={{
                          position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                          background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 13,
                        }}>{showPw ? '🙈' : '👁'}</button>
                      }
                    />
                    <div style={{ color: '#334155', fontSize: 10, marginTop: 6 }}>Encrypts the wallet keystore. Keep this safe — you'll need it to recover the wallet.</div>
                  </div>

                  {!genWallet ? (
                    <>
                      <button
                        onClick={generateWallet}
                        disabled={!password || generating}
                        style={{
                          padding: '11px', borderRadius: 8, cursor: password && !generating ? 'pointer' : 'not-allowed',
                          background: password && !generating ? `linear-gradient(135deg, #1e3050, #0d1a30)` : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${password && !generating ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)'}`,
                          color: password && !generating ? '#e2e8f0' : '#1e3050',
                          fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', fontFamily: 'inherit',
                          transition: 'all 0.2s',
                        }}
                      >
                        {generating
                          ? (encryptProgress != null ? `ENCRYPTING… ${encryptProgress}%` : 'GENERATING…')
                          : '⚡ GENERATE WALLET'}
                      </button>
                      {encryptProgress != null && (
                        <div style={{ borderRadius: 4, overflow: 'hidden', background: 'rgba(255,255,255,0.05)', height: 3 }}>
                          <div style={{ height: '100%', width: `${encryptProgress}%`, background: G, transition: 'width 0.15s linear', boxShadow: `0 0 6px ${G}` }} />
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ padding: '12px 16px', borderRadius: 8, background: `${G}0a`, border: `1px solid ${G}25`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ color: '#334155', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', marginBottom: 3 }}>BOT ADDRESS</div>
                          <div style={{ color: G, fontSize: 12, fontFamily: 'Space Mono,monospace' }}>
                            {genWallet.address.slice(0, 12)}…{genWallet.address.slice(-6)}
                          </div>
                        </div>
                        <div style={{ color: G, fontSize: 18 }}>✓</div>
                      </div>
                      <button onClick={downloadKeystore} style={{
                        padding: '10px', borderRadius: 8, cursor: 'pointer',
                        background: keystoreDownloaded ? `${G}10` : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${keystoreDownloaded ? `${G}40` : 'rgba(255,255,255,0.1)'}`,
                        color: keystoreDownloaded ? G : '#64748b',
                        fontSize: 12, fontWeight: 600, fontFamily: 'inherit', letterSpacing: '0.08em',
                        transition: 'all 0.2s',
                      }}>
                        {keystoreDownloaded ? '✓ KEYSTORE SAVED' : '↓ SAVE KEYSTORE (recommended)'}
                      </button>
                      <div style={{ color: '#1e3050', fontSize: 10, textAlign: 'center' }}>
                        Save your keystore file — it's the only way to recover this wallet later.
                      </div>
                    </div>
                  )}
                  {genError && <div style={{ color: '#f87171', fontSize: 12 }}>{genError}</div>}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <DropZone
                    file={keystoreName}
                    onFile={handleUploadKeystore}
                    hint="Drop your keystore JSON here or click to browse"
                  />
                  {uploadError && <div style={{ color: '#f87171', fontSize: 12 }}>{uploadError}</div>}
                  {uploadAddress && (
                    <div style={{ padding: '10px 14px', borderRadius: 8, background: `${G}0a`, border: `1px solid ${G}25`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: '#475569', fontSize: 11 }}>Bot address</span>
                      <span style={{ color: G, fontSize: 11, fontFamily: 'Space Mono,monospace' }}>
                        {uploadAddress.slice(0, 10)}…{uploadAddress.slice(-6)}
                      </span>
                    </div>
                  )}
                  <div>
                    <div style={{ color: '#334155', fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', marginBottom: 8 }}>KEYSTORE PASSWORD</div>
                    <InputField
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Enter keystore password"
                      suffix={
                        <button onClick={() => setShowPw(v => !v)} style={{
                          position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                          background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 13,
                        }}>{showPw ? '🙈' : '👁'}</button>
                      }
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Step 3 — Strategy sliders */}
            <div style={{ background: '#0d1520', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: 24, opacity: step2Done ? 1 : 0.35, transition: 'opacity 0.2s', pointerEvents: step2Done ? 'auto' : 'none' }}>
              <StepHeader num="03" title="Strategy" done={false} active={step2Done} />

              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {(showAdvanced ? SLIDERS : SLIDERS.slice(0, 5)).map(({ key, label, hint }) => (
                  <div key={key}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 7 }}>
                      <div>
                        <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{label}</span>
                        <div style={{ color: '#334155', fontSize: 10, marginTop: 1 }}>{hint}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <span style={{ color: accent, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', minWidth: 64, textAlign: 'right' }}>{sliderLabel(sliders[key])}</span>
                        <span style={{ color: '#475569', fontSize: 10, fontFamily: 'Space Mono,monospace', minWidth: 22, textAlign: 'right' }}>{sliders[key]}</span>
                      </div>
                    </div>
                    <input type="range" min={0} max={100} value={sliders[key]}
                      onChange={e => { setPreset('custom'); setSliders(s => ({ ...s, [key]: Number(e.target.value) })); }}
                      style={{ width: '100%', height: 3, accentColor: accent, cursor: 'pointer', outline: 'none' }}
                    />
                  </div>
                ))}

                <button onClick={() => setShowAdvanced(v => !v)} style={{
                  background: 'none', border: 'none', color: '#334155', fontSize: 11, cursor: 'pointer',
                  padding: 0, textAlign: 'left', fontFamily: 'inherit', letterSpacing: '0.05em',
                }}>
                  {showAdvanced ? '▲ hide advanced sliders' : '▼ show all sliders'}
                </button>

                {/* Stack depth toggle */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div>
                    <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, marginBottom: 2 }}>Stack Depth Adjustment</div>
                    <div style={{ color: '#334155', fontSize: 10 }}>Tighten range when effective SPR {'<'} 4</div>
                  </div>
                  <button onClick={() => { setStackDepth(v => !v); setPreset('custom'); }} style={{
                    width: 46, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                    background: stackDepth ? accent : '#1e3050', transition: 'background 0.2s', position: 'relative', flexShrink: 0,
                  }}>
                    <div style={{ position: 'absolute', top: 3, left: stackDepth ? 23 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.5)' }} />
                  </button>
                </div>
              </div>
            </div>

            {/* Step 4 — Game selection */}
            <div style={{ background: '#0d1520', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: 24, opacity: step2Done ? 1 : 0.35, transition: 'opacity 0.2s', pointerEvents: step2Done ? 'auto' : 'none' }}>
              <StepHeader num="04" title="Game (optional)" done={false} active={step2Done} />
              <div style={{ color: '#475569', fontSize: 12, marginBottom: 14, lineHeight: 1.5 }}>
                Select a live game to join, or leave blank to auto-discover a joinable game within your configured buy-in range.
              </div>
              {liveGames.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                  {liveGames.slice(0, 6).map(g => (
                    <button key={g.gameId} onClick={() => { setSelectedGameId(selectedGameId === g.gameId ? null : g.gameId); setManualGameId(''); }} style={{
                      padding: '10px 14px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                      background: selectedGameId === g.gameId ? `${VIOLET}15` : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${selectedGameId === g.gameId ? `${VIOLET}50` : 'rgba(255,255,255,0.07)'}`,
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      transition: 'all 0.15s',
                    }}>
                      <div>
                        <span style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 600, fontFamily: 'Space Mono,monospace' }}>Game #{g.gameId}</span>
                        <span style={{ color: '#475569', fontSize: 11, marginLeft: 12 }}>{g.playerCount}/{g.maxSeats} players</span>
                        {g.stage !== 'waiting' && <span style={{ color: G, fontSize: 10, marginLeft: 8, fontWeight: 700 }}>LIVE</span>}
                      </div>
                      <span style={{ color: '#334155', fontSize: 11, fontFamily: 'Space Mono,monospace' }}>
                        {g.depositAmountUsdc != null ? `${g.depositAmountUsdc} USDC` : '—'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ color: '#475569', fontSize: 12 }}>or enter game ID:</span>
                <input type="number" value={manualGameId}
                  onChange={e => { setManualGameId(e.target.value); setSelectedGameId(null); }}
                  placeholder="e.g. 5"
                  style={{ width: 90, padding: '8px 12px', borderRadius: 7, background: '#060d14', border: '1px solid rgba(255,255,255,0.08)', color: '#e2e8f0', fontSize: 13, outline: 'none', fontFamily: 'Space Mono,monospace' }}
                />
              </div>
            </div>

            {/* Create button */}
            {activateError && (
              <div style={{ padding: '12px 16px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', fontSize: 13 }}>
                {activateError}
              </div>
            )}

            <button onClick={handleCreateBot} disabled={!canCreate} style={{
              padding: '16px', borderRadius: 10, border: 'none',
              background: canCreate ? `linear-gradient(135deg, ${G}, #00b4d8)` : 'rgba(255,255,255,0.05)',
              color: canCreate ? '#000' : '#334155',
              fontSize: 15, fontWeight: 900, letterSpacing: '0.14em',
              cursor: canCreate ? 'pointer' : 'not-allowed', transition: 'all 0.2s',
              boxShadow: canCreate ? `0 0 40px ${G}25` : 'none',
            }}>
              {activating ? '⏳ LAUNCHING BOT…' : 'CREATE BOT'}
            </button>

            {!step2Done && (
              <div style={{ color: '#1e3050', fontSize: 12, textAlign: 'center' }}>
                {!effectiveKeystoreJson ? 'Generate or upload a wallet to continue.' : 'Enter the wallet password to continue.'}
              </div>
            )}
          </div>

          {/* ── Right column ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 24 }}>

            {/* Persona presets */}
            <div style={{ background: '#0d1520', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 18 }}>
              <div style={{ color: '#334155', fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', marginBottom: 14 }}>PERSONA</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {Object.entries(PRESETS).map(([key, { label, desc, color }]) => (
                  <button key={key} onClick={() => applyPreset(key)} style={{
                    padding: '10px 14px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                    background: preset === key ? `${color}12` : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${preset === key ? `${color}50` : 'rgba(255,255,255,0.06)'}`,
                    transition: 'all 0.15s', width: '100%',
                  }}>
                    <div style={{ color: preset === key ? color : '#64748b', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 2 }}>{label}</div>
                    <div style={{ color: preset === key ? color : '#334155', fontSize: 10, fontWeight: 400 }}>{desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* USDC params */}
            <div style={{ background: '#0d1520', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 18 }}>
              <div style={{ color: '#334155', fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', marginBottom: 14 }}>BUY-IN (USDC)</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { label: 'DEPOSIT PER GAME', value: depositUsdc, setter: setDepositUsdc, hint: 'How much you stake per game' },
                  { label: 'MAX AUTO-JOIN', value: maxBuyIn, setter: setMaxBuyIn, hint: 'Skip games above this amount' },
                ].map(({ label, value, setter, hint }) => (
                  <div key={label}>
                    <div style={{ color: '#475569', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 5 }}>{label}</div>
                    <div style={{ position: 'relative' }}>
                      <input type="number" min="0.01" step="0.01" value={value}
                        onChange={e => setter(e.target.value)}
                        style={{ width: '100%', padding: '9px 36px 9px 10px', borderRadius: 7, boxSizing: 'border-box', background: '#060d14', border: '1px solid rgba(255,255,255,0.08)', color: '#e2e8f0', fontSize: 13, outline: 'none', fontFamily: 'Space Mono,monospace' }}
                      />
                      <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#334155', fontSize: 11 }}>USDC</span>
                    </div>
                    <div style={{ color: '#1e3050', fontSize: 10, marginTop: 3 }}>{hint}</div>
                  </div>
                ))}
                <div>
                  <div style={{ color: '#475569', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 5 }}>BLIND ESCALATION</div>
                  <div style={{ position: 'relative' }}>
                    <input type="number" min="1" step="1" value={blindInterval}
                      onChange={e => setBlindInterval(e.target.value)}
                      style={{ width: '100%', padding: '9px 60px 9px 10px', borderRadius: 7, boxSizing: 'border-box', background: '#060d14', border: '1px solid rgba(255,255,255,0.08)', color: '#e2e8f0', fontSize: 13, outline: 'none', fontFamily: 'Space Mono,monospace' }}
                    />
                    <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#334155', fontSize: 11 }}>hands</span>
                  </div>
                  <div style={{ color: '#1e3050', fontSize: 10, marginTop: 3 }}>Blinds double every N hands</div>
                </div>
              </div>
            </div>

            {/* Custom instructions */}
            <div style={{ background: '#0d1520', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 18 }}>
              <div style={{ color: '#334155', fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', marginBottom: 10 }}>CUSTOM INSTRUCTIONS</div>
              <textarea value={customInstructions} onChange={e => setCustomInstructions(e.target.value)}
                placeholder={'e.g. Always raise with pocket aces.\nFold any hand below top 15% on the river.'}
                rows={4} style={{
                  width: '100%', padding: '9px 10px', borderRadius: 7, boxSizing: 'border-box',
                  background: '#060d14', border: '1px solid rgba(255,255,255,0.08)',
                  color: '#e2e8f0', fontSize: 11, resize: 'vertical', outline: 'none',
                  fontFamily: 'Space Mono,monospace', lineHeight: 1.5,
                }}
              />
              <div style={{ color: '#1e3050', fontSize: 10, marginTop: 5 }}>Appended to Claude's system prompt.</div>
            </div>

            {/* Config preview */}
            <div style={{ background: '#060d14', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 12, padding: 14, maxHeight: 200, overflow: 'auto' }}>
              <div style={{ color: '#1e3050', fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', marginBottom: 8 }}>CONFIG PREVIEW</div>
              <pre style={{ color: '#334155', fontSize: 9, margin: 0, fontFamily: 'Space Mono,monospace', lineHeight: 1.5 }}>
                {JSON.stringify(buildConfig(), null, 2)}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
