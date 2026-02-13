# CryptoPoker — Crypto Texas Hold'em on Base

A full-stack poker platform where the currency is your ERC-20 token on Base.

## Project Structure

```
poker-platform/
├── contracts/
│   └── PokerVault.sol        # ERC-20 deposit/withdrawal vault
├── server/
│   ├── src/
│   │   ├── server.js         # Express + Socket.IO game server
│   │   ├── poker-engine.js   # Texas Hold'em game logic
│   │   ├── security.js       # Auth, HMAC, JWT, voucher signing
│   │   └── config.js         # All configurable settings
│   ├── .env.example
│   └── package.json
├── client/
│   ├── src/
│   │   ├── App.jsx           # Root (Wagmi + RainbowKit)
│   │   ├── components/
│   │   │   └── PokerTable.jsx # Game table UI
│   │   ├── pages/
│   │   │   └── Lobby.jsx     # Table selection + deposit
│   │   ├── context/
│   │   │   └── GameContext.jsx # Socket.IO game state
│   │   ├── hooks/
│   │   │   └── useAuth.js    # Wallet login flow
│   │   └── utils/
│   │       └── web3Config.js # Chain + contract config
│   └── package.json
└── DEPLOYMENT.md             # Full AWS setup guide
```

## Quick Start (Local Dev)

```bash
# Server
cd server
cp .env.example .env    # fill in values
npm install
npm run dev

# Client (new terminal)
cd client
cp .env.example .env    # fill in same API key + token addresses
npm install
npm run dev
```

## Security Model

- **API Key**: Every HTTP and WS connection must include `X-Poker-Key`
- **JWT**: Players authenticate with wallet signature → short-lived JWT
- **HMAC**: All WS message payloads are HMAC-SHA256 signed
- **Voucher Signing**: Withdrawals require a server-signed EIP-191 voucher
- **Nonce system**: Prevents withdrawal voucher replay attacks
- **Chain ID baked in**: Prevents cross-chain voucher replay

## Fee Structure

| Event        | Fee | Contract enforced? |
|-------------|-----|-------------------|
| Buy chips    | 8%  | ✅ Yes             |
| Win & cash out | 5% | ✅ Yes            |

## Configurable Per-Table Settings

See `server/src/config.js` → `tables.stakes` for:
- Blind levels
- Min/max buy-in
- Max seats
- Min players to start (default: **2** for testing)
