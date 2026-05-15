import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { SERVER_URL, SERVER_API_KEY } from '../utils/web3Config';

const BG     = '#090d14';
const G      = '#00e676';
const VIOLET = '#a855f7';
const P      = '#ff0070';

function DropZone({ label, accept, file, onFile, hint }) {
  const inputRef  = useRef(null);
  const [drag, setDrag] = useState(false);

  function handleDrop(e) {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) readFile(f);
  }
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
      onDrop={handleDrop}
      style={{
        padding: '22px 20px', borderRadius: 10, cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s',
        background: drag ? `${VIOLET}10` : file ? `${G}08` : 'rgba(255,255,255,0.02)',
        border: `2px dashed ${drag ? VIOLET : file ? G : 'rgba(255,255,255,0.12)'}`,
      }}>
      <input ref={inputRef} type="file" accept={accept} style={{ display: 'none' }}
        onChange={e => { if (e.target.files[0]) readFile(e.target.files[0]); }} />
      {file ? (
        <div style={{ color: G, fontSize: 13, fontWeight: 600 }}>
          <div style={{ marginBottom: 3 }}>✓ {file}</div>
          <div style={{ color: '#334155', fontSize: 11 }}>Click or drop to replace</div>
        </div>
      ) : (
        <div>
          <div style={{ color: '#334155', fontSize: 13, marginBottom: 4 }}>{label}</div>
          <div style={{ color: '#1e3050', fontSize: 11 }}>{hint}</div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children, active = true }) {
  return (
    <div style={{ marginBottom: 24, opacity: active ? 1 : 0.35, transition: 'opacity 0.2s' }}>
      <div style={{ color: '#334155', fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

export default function ActivateAgent({ token, address }) {
  // ── Upload state ──
  const [keystoreName, setKeystoreName]   = useState(null);
  const [keystoreJson, setKeystoreJson]   = useState(null);
  const [botAddress, setBotAddress]       = useState(null);
  const [keystoreError, setKeystoreError] = useState(null);

  const [password, setPassword]           = useState('');
  const [showPw, setShowPw]               = useState(false);

  const [configName, setConfigName]       = useState(null);
  const [configJson, setConfigJson]       = useState(null);
  const [configError, setConfigError]     = useState(null);

  const [selectedGameId, setSelectedGameId] = useState(null);
  const [manualGameId, setManualGameId]   = useState('');
  const [liveGames, setLiveGames]         = useState([]);

  // ── Activation state ──
  const [activating, setActivating]       = useState(false);
  const [activateError, setActivateError] = useState(null);
  const [agentStatus, setAgentStatus]     = useState(null);  // null | { status, gameId, output }

  const pollRef = useRef(null);

  // ── Poll agent status once active ──
  useEffect(() => {
    if (!token) return;

    async function poll() {
      try {
        const res = await fetch(`${SERVER_URL}/agent/status`, {
          headers: { 'X-Poker-Key': SERVER_API_KEY, 'Authorization': `Bearer ${token}` },
        });
        const data = await res.json();
        setAgentStatus(data?.status && data.status !== 'none' ? data : null);
      } catch { /* server unreachable */ }
    }

    poll();
    pollRef.current = setInterval(poll, 4000);
    return () => clearInterval(pollRef.current);
  }, [token]);

  // ── Fetch live games ──
  useEffect(() => {
    async function fetchGames() {
      try {
        const res = await fetch(`${SERVER_URL}/api/games`);
        if (res.ok) setLiveGames(await res.json());
      } catch { /* server unreachable */ }
    }
    fetchGames();
    const id = setInterval(fetchGames, 8000);
    return () => clearInterval(id);
  }, []);

  function handleKeystoreFile(name, text) {
    setKeystoreError(null);
    setBotAddress(null);
    try {
      const parsed = JSON.parse(text);
      if (!parsed.version || !parsed.crypto) throw new Error('Not a valid EIP-55 keystore');
      const addr = parsed.address
        ? ('0x' + parsed.address.replace(/^0x/i, ''))
        : null;
      setKeystoreJson(text);
      setKeystoreName(name);
      setBotAddress(addr);
    } catch (e) {
      setKeystoreError(e.message || 'Invalid keystore file');
    }
  }

  function handleConfigFile(name, text) {
    setConfigError(null);
    try {
      JSON.parse(text);
      setConfigJson(text);
      setConfigName(name);
    } catch {
      setConfigError('Invalid JSON in config file');
    }
  }

  const effectiveGameId = selectedGameId ?? (manualGameId.trim() ? Number(manualGameId.trim()) : null);

  async function handleActivate() {
    if (!keystoreJson || !password) return;
    setActivateError(null);
    setActivating(true);
    try {
      const body = {
        keystoreJson,
        keystorePassword: password,
        config: configJson ? JSON.parse(configJson) : {},
        gameId: effectiveGameId ?? 0,
        botAddress: botAddress || null,
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
    } catch (e) {
      console.error('Stop agent error:', e);
    }
  }

  const isRunning = agentStatus?.status === 'running';
  const canActivate = !!keystoreJson && !!password && !activating && !isRunning;

  // ── Active bot panel ──
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

          {/* Status card */}
          <div style={{ background: '#0d1520', border: `1px solid ${G}30`, borderRadius: 14, padding: 24, marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: G, boxShadow: `0 0 8px ${G}` }} />
                  <span style={{ color: G, fontSize: 11, fontWeight: 700, letterSpacing: '0.14em' }}>RUNNING</span>
                </div>
                <div style={{ color: '#475569', fontSize: 12, fontFamily: 'Space Mono,monospace' }}>
                  Owner: {address?.slice(0, 8)}…{address?.slice(-4)}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: '#334155', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', marginBottom: 4 }}>GAME ID</div>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 16, fontFamily: 'Space Mono,monospace' }}>
                  #{agentStatus.gameId}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Link to={`/spectate/${agentStatus.gameId}`} style={{
                flex: 1, padding: '11px', borderRadius: 8, textDecoration: 'none', textAlign: 'center',
                background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.3)',
                color: VIOLET, fontSize: 13, fontWeight: 700, letterSpacing: '0.1em',
              }}>
                👁 WATCH GAME
              </Link>
              <button onClick={handleStop} style={{
                padding: '11px 20px', borderRadius: 8, border: `1px solid ${P}40`,
                background: `${P}10`, color: P, fontSize: 13, fontWeight: 700, letterSpacing: '0.1em',
                cursor: 'pointer',
              }}>
                STOP BOT
              </button>
            </div>
          </div>

          {/* Logs */}
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

  // ── Setup panel ──
  return (
    <div style={{ minHeight: 'calc(100vh - 60px)', background: BG, fontFamily: "'Space Grotesk','Outfit',sans-serif" }}>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '48px 24px 64px' }}>

        {/* Header */}
        <div style={{ marginBottom: 36 }}>
          <div style={{ color: '#334155', fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', marginBottom: 8 }}>// AI BOTS</div>
          <h1 style={{ color: '#fff', fontWeight: 900, fontSize: 32, letterSpacing: '0.04em', textTransform: 'uppercase', lineHeight: 1, margin: '0 0 10px' }}>
            ACTIVATE <span style={{ color: VIOLET }}>AGENT</span>
          </h1>
          <p style={{ color: '#475569', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            Upload your keystore and config to launch your bot on the server.{' '}
            <Link to="/bots" style={{ color: VIOLET, textDecoration: 'none' }}>Configure bot →</Link>
          </p>
        </div>

        {/* Step 1 — Keystore */}
        <Section title="STEP 1 — KEYSTORE (wallet.json)">
          <DropZone
            label="Drop your keystore file here"
            accept=".json,application/json"
            file={keystoreName}
            onFile={handleKeystoreFile}
            hint="Click to browse · EIP-55 encrypted keystore"
          />
          {keystoreError && (
            <div style={{ color: '#f87171', fontSize: 12, marginTop: 8 }}>{keystoreError}</div>
          )}
          {botAddress && (
            <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 8, background: `${G}0a`, border: `1px solid ${G}25`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#475569', fontSize: 11 }}>Bot address</span>
              <span style={{ color: G, fontSize: 11, fontFamily: 'Space Mono,monospace' }}>
                {botAddress.slice(0, 8)}…{botAddress.slice(-6)}
              </span>
            </div>
          )}
          {!botAddress && (
            <div style={{ marginTop: 10, color: '#334155', fontSize: 11 }}>
              Don't have a keystore?{' '}
              <code style={{ color: '#94a3b8', fontSize: 11 }}>npm run generate-wallet</code> in the <code style={{ color: '#94a3b8', fontSize: 11 }}>agent/</code> directory.
            </div>
          )}
        </Section>

        {/* Step 2 — Password */}
        <Section title="STEP 2 — KEYSTORE PASSWORD" active={!!keystoreJson}>
          <div style={{ position: 'relative' }}>
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter keystore password"
              style={{
                width: '100%', padding: '12px 44px 12px 16px', borderRadius: 8, boxSizing: 'border-box',
                background: '#060d14', border: '1px solid rgba(255,255,255,0.08)',
                color: '#e2e8f0', fontSize: 14, outline: 'none', fontFamily: 'Space Mono,monospace',
              }}
            />
            <button onClick={() => setShowPw(v => !v)} style={{
              position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 14,
            }}>{showPw ? '🙈' : '👁'}</button>
          </div>
          <div style={{ color: '#334155', fontSize: 11, marginTop: 6 }}>
            Decrypted in-memory on the server only. Never persisted.
          </div>
        </Section>

        {/* Step 3 — Config */}
        <Section title="STEP 3 — STRATEGY CONFIG (optional)" active={!!keystoreJson && !!password}>
          <DropZone
            label="Drop your config.json here"
            accept=".json,application/json"
            file={configName}
            onFile={handleConfigFile}
            hint="Leave blank to use default GTO strategy"
          />
          {configError && (
            <div style={{ color: '#f87171', fontSize: 12, marginTop: 8 }}>{configError}</div>
          )}
          {!configName && (
            <div style={{ marginTop: 10, color: '#334155', fontSize: 11 }}>
              No config? <Link to="/bots" style={{ color: VIOLET, textDecoration: 'none' }}>Configure and download one →</Link>
            </div>
          )}
        </Section>

        {/* Step 4 — Game selection */}
        <Section title="STEP 4 — SELECT GAME (optional)" active={!!keystoreJson && !!password}>
          <div style={{ marginBottom: 12, color: '#475569', fontSize: 12 }}>
            Select a game to join, or leave blank to auto-discover within your configured price range.
          </div>
          {liveGames.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {liveGames.slice(0, 8).map(g => (
                <button key={g.gameId} onClick={() => setSelectedGameId(selectedGameId === g.gameId ? null : g.gameId)} style={{
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
            <input type="number" value={manualGameId} onChange={e => { setManualGameId(e.target.value); setSelectedGameId(null); }}
              placeholder="e.g. 5"
              style={{ width: 100, padding: '8px 12px', borderRadius: 7, background: '#060d14', border: '1px solid rgba(255,255,255,0.08)', color: '#e2e8f0', fontSize: 13, outline: 'none', fontFamily: 'Space Mono,monospace' }} />
          </div>
        </Section>

        {/* Activate button */}
        {activateError && (
          <div style={{ padding: '12px 16px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', fontSize: 13, marginBottom: 16 }}>
            {activateError}
          </div>
        )}

        <button onClick={handleActivate} disabled={!canActivate} style={{
          width: '100%', padding: '14px', borderRadius: 8, border: 'none',
          background: canActivate ? `linear-gradient(135deg, ${VIOLET}, #6d28d9)` : 'rgba(255,255,255,0.05)',
          color: canActivate ? '#fff' : '#334155', fontSize: 14, fontWeight: 800, letterSpacing: '0.12em',
          cursor: canActivate ? 'pointer' : 'not-allowed', transition: 'all 0.2s',
          boxShadow: canActivate ? `0 0 30px ${VIOLET}30` : 'none',
        }}>
          {activating ? '⏳ LAUNCHING BOT…' : '🤖 ACTIVATE BOT'}
        </button>

        {!keystoreJson && (
          <div style={{ color: '#1e3050', fontSize: 11, textAlign: 'center', marginTop: 10 }}>Upload a keystore to continue.</div>
        )}
        {keystoreJson && !password && (
          <div style={{ color: '#1e3050', fontSize: 11, textAlign: 'center', marginTop: 10 }}>Enter your keystore password to continue.</div>
        )}
      </div>
    </div>
  );
}
