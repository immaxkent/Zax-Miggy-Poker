import { useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { SERVER_URL, SERVER_API_KEY } from '../utils/web3Config';

const G  = '#00e676';
const BG = '#090d14';

function UploadZone({ file, onFile, label }) {
  const inputRef = useRef();
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  }, [onFile]);

  const handleDragOver = (e) => { e.preventDefault(); setDragging(true); };
  const handleDragLeave = () => setDragging(false);

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      style={{
        border: `1px dashed ${dragging ? G : file ? `${G}80` : 'rgba(255,255,255,0.15)'}`,
        borderRadius: 10,
        padding: '20px 24px',
        cursor: 'pointer',
        textAlign: 'center',
        background: dragging ? `${G}08` : file ? `${G}06` : 'rgba(255,255,255,0.02)',
        transition: 'all 0.15s',
        userSelect: 'none',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={e => e.target.files[0] && onFile(e.target.files[0])}
      />
      {file ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <span style={{ color: G, fontSize: 16 }}>✓</span>
          <span style={{ color: G, fontSize: 13, fontWeight: 700, fontFamily: 'Space Mono, monospace' }}>{file.name}</span>
        </div>
      ) : (
        <>
          <div style={{ color: '#475569', fontSize: 22, marginBottom: 6 }}>⬆</div>
          <div style={{ color: '#94a3b8', fontSize: 13, fontWeight: 600 }}>{label}</div>
          <div style={{ color: '#334155', fontSize: 11, marginTop: 4 }}>drag & drop or click to browse</div>
        </>
      )}
    </div>
  );
}

export default function LaunchBot() {
  const [keystoreFile, setKeystoreFile] = useState(null);
  const [configFile, setConfigFile]     = useState(null);
  const [password, setPassword]         = useState('');
  const [apiKey, setApiKey]             = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [launching, setLaunching]       = useState(false);
  const [error, setError]               = useState(null);
  const [result, setResult]             = useState(null); // { botAddress, gameId }
  const [polledGameId, setPolledGameId] = useState(null);

  const readFileAsText = (file) => new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = e => res(e.target.result);
    reader.onerror = () => rej(new Error('Failed to read file'));
    reader.readAsText(file);
  });

  async function launch() {
    if (!keystoreFile || !password || launching) return;
    setLaunching(true);
    setError(null);

    try {
      const keystoreJson = await readFileAsText(keystoreFile);

      // Basic sanity check client-side
      let ks;
      try { ks = JSON.parse(keystoreJson); } catch {
        throw new Error('Keystore file is not valid JSON.');
      }
      if (!ks.address) throw new Error('Keystore is missing the "address" field.');

      let botConfig = {};
      if (configFile) {
        try { botConfig = JSON.parse(await readFileAsText(configFile)); } catch {
          throw new Error('Config file is not valid JSON.');
        }
      }

      const body = {
        keystoreJson,
        keystorePassword: password,
        config: botConfig,
      };
      if (apiKey.trim()) body.anthropicApiKey = apiKey.trim();

      const res = await fetch(`${SERVER_URL}/agent/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Poker-Key': SERVER_API_KEY },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);

      setResult({ botAddress: data.botAddress, gameId: data.gameId });

      // If no gameId yet, start polling
      if (!data.gameId) {
        const botAddr = data.botAddress;
        const interval = setInterval(async () => {
          try {
            const sr = await fetch(`${SERVER_URL}/agent/status/${botAddr}`, {
              headers: { 'X-Poker-Key': SERVER_API_KEY },
            });
            const sd = await sr.json();
            if (sd?.gameId != null) {
              setPolledGameId(sd.gameId);
              clearInterval(interval);
            }
          } catch { /* ignore */ }
        }, 3000);
      }
    } catch (e) {
      setError(e.message || 'Launch failed');
    } finally {
      setLaunching(false);
    }
  }

  const displayGameId = result?.gameId ?? polledGameId;

  return (
    <div style={{
      minHeight: '100vh', background: BG,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '80px 24px 40px',
    }}>
      <div style={{ width: '100%', maxWidth: 520 }}>

        {/* Back link */}
        <Link to="/" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          color: '#475569', fontSize: 12, fontWeight: 600, letterSpacing: '0.1em',
          textDecoration: 'none', marginBottom: 32,
        }}>
          ← HOME
        </Link>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 16,
            background: `${G}14`, border: `1px solid ${G}40`, borderRadius: 24,
            padding: '4px 14px', color: G, fontSize: 10, fontWeight: 700, letterSpacing: '0.18em',
          }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: G, boxShadow: `0 0 6px ${G}` }} />
            BOT LAUNCHER
          </div>
          <h1 style={{ color: '#fff', fontSize: 28, fontWeight: 900, letterSpacing: '0.06em', textTransform: 'uppercase', margin: 0, lineHeight: 1.15 }}>
            JOIN LOBBY<br /><span style={{ color: G }}>WITH BOT</span>
          </h1>
          <p style={{ color: '#475569', fontSize: 13, marginTop: 10, lineHeight: 1.6 }}>
            Upload a keystore file generated in the Bot Wizard to launch your agent into a live USDC game.
          </p>
        </div>

        {result ? (
          /* ── Success state ── */
          <div style={{
            background: '#0d1520', border: `1px solid ${G}40`, borderRadius: 14,
            padding: 32, textAlign: 'center',
          }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>🤖</div>
            <div style={{ color: G, fontWeight: 800, fontSize: 16, letterSpacing: '0.1em', marginBottom: 8 }}>BOT LAUNCHED</div>
            <div style={{
              color: '#64748b', fontSize: 11, fontFamily: 'Space Mono, monospace',
              marginBottom: 20, wordBreak: 'break-all', padding: '8px 12px',
              background: 'rgba(255,255,255,0.03)', borderRadius: 6, border: '1px solid rgba(255,255,255,0.07)',
            }}>
              {result.botAddress}
            </div>

            {displayGameId != null ? (
              <Link to={`/spectate/${displayGameId}`} style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '12px 28px', borderRadius: 8, textDecoration: 'none',
                background: `linear-gradient(135deg, ${G}, #00b4d8)`,
                color: '#000', fontSize: 13, fontWeight: 800, letterSpacing: '0.1em',
              }}>
                WATCH GAME #{displayGameId} →
              </Link>
            ) : (
              <div style={{ color: '#475569', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%', background: G,
                  boxShadow: `0 0 8px ${G}`,
                  animation: 'pulse 1.2s ease-in-out infinite',
                }} />
                Bot is finding a game…
              </div>
            )}

            <div style={{ marginTop: 24 }}>
              <Link to="/lobby" style={{ color: '#475569', fontSize: 12, textDecoration: 'none' }}>
                ← View lobby
              </Link>
            </div>
          </div>
        ) : (
          /* ── Upload form ── */
          <div style={{
            background: '#0d1520', border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 14, padding: 32, display: 'flex', flexDirection: 'column', gap: 20,
          }}>

            {/* Keystore upload */}
            <div>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', marginBottom: 8 }}>
                KEYSTORE FILE <span style={{ color: G }}>*</span>
              </label>
              <UploadZone
                file={keystoreFile}
                onFile={setKeystoreFile}
                label="Drop keystore.json here"
              />
              {keystoreFile && (
                <button
                  onClick={() => setKeystoreFile(null)}
                  style={{ marginTop: 6, background: 'none', border: 'none', color: '#475569', fontSize: 11, cursor: 'pointer', padding: 0 }}
                >
                  × clear
                </button>
              )}
            </div>

            {/* Password */}
            <div>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', marginBottom: 8 }}>
                KEYSTORE PASSWORD <span style={{ color: G }}>*</span>
              </label>
              <input
                type="password"
                placeholder="Enter encryption password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && launch()}
                autoComplete="current-password"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8, padding: '11px 14px', color: '#e2e8f0', fontSize: 14,
                  outline: 'none', fontFamily: 'inherit',
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => e.target.style.borderColor = `${G}60`}
                onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
              />
            </div>

            {/* Advanced toggle */}
            <button
              onClick={() => setShowAdvanced(v => !v)}
              style={{
                background: 'none', border: 'none', color: '#475569',
                fontSize: 12, fontWeight: 600, letterSpacing: '0.1em',
                cursor: 'pointer', padding: 0, textAlign: 'left',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <span style={{ transition: 'transform 0.15s', display: 'inline-block', transform: showAdvanced ? 'rotate(90deg)' : 'none' }}>▶</span>
              ADVANCED OPTIONS
            </button>

            {showAdvanced && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingLeft: 16, borderLeft: '2px solid rgba(255,255,255,0.06)' }}>

                {/* Anthropic API key */}
                <div>
                  <label style={{ display: 'block', color: '#64748b', fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', marginBottom: 6 }}>
                    ANTHROPIC API KEY <span style={{ color: '#475569', fontWeight: 400 }}>(optional)</span>
                  </label>
                  <input
                    type="password"
                    placeholder="sk-ant-…"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 8, padding: '10px 14px', color: '#e2e8f0', fontSize: 13,
                      outline: 'none', fontFamily: 'Space Mono, monospace',
                      transition: 'border-color 0.15s',
                    }}
                    onFocus={e => e.target.style.borderColor = `${G}50`}
                    onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'}
                  />
                  <p style={{ color: '#334155', fontSize: 11, margin: '4px 0 0' }}>
                    Overrides the server default. Required for AI-powered decision making.
                  </p>
                </div>

                {/* Config upload */}
                <div>
                  <label style={{ display: 'block', color: '#64748b', fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', marginBottom: 6 }}>
                    CONFIG FILE <span style={{ color: '#475569', fontWeight: 400 }}>(optional)</span>
                  </label>
                  <UploadZone
                    file={configFile}
                    onFile={setConfigFile}
                    label="Drop config.json here"
                  />
                  {configFile && (
                    <button
                      onClick={() => setConfigFile(null)}
                      style={{ marginTop: 6, background: 'none', border: 'none', color: '#475569', fontSize: 11, cursor: 'pointer', padding: 0 }}
                    >
                      × clear
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div style={{
                padding: '10px 14px', borderRadius: 8,
                background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                color: '#f87171', fontSize: 13,
              }}>
                {error}
              </div>
            )}

            {/* Launch button */}
            <button
              onClick={launch}
              disabled={!keystoreFile || !password || launching}
              style={{
                padding: '14px', borderRadius: 9, border: 'none',
                background: keystoreFile && password && !launching
                  ? `linear-gradient(135deg, ${G}, #00b4d8)`
                  : 'rgba(255,255,255,0.06)',
                color: keystoreFile && password && !launching ? '#000' : '#334155',
                fontSize: 14, fontWeight: 800, letterSpacing: '0.12em',
                cursor: keystoreFile && password && !launching ? 'pointer' : 'not-allowed',
                transition: 'all 0.15s',
                boxShadow: keystoreFile && password && !launching ? `0 0 24px ${G}30` : 'none',
              }}
            >
              {launching ? 'LAUNCHING…' : 'LAUNCH BOT →'}
            </button>

            <p style={{ color: '#334155', fontSize: 11, textAlign: 'center', margin: 0 }}>
              Don't have a keystore?{' '}
              <Link to="/bots" style={{ color: G, textDecoration: 'none', fontWeight: 700 }}>Generate one →</Link>
            </p>
          </div>
        )}

        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(0.8); }
          }
        `}</style>
      </div>
    </div>
  );
}
