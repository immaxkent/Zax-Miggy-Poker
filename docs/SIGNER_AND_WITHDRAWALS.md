# Why the server has a signer private key (withdrawals)

## Short answer

The private key on the server is **not** for deploying contracts or sending transactions. It is used **only to sign withdrawal vouchers**. When a player wants to cash out winnings, the server signs a message that the **PokerVault** contract trusts; the **player’s EOA** then calls `withdraw(...)` on-chain and receives the tokens. The server never holds or moves tokens.

---

## Flow

1. **Vault is deployed** with a `serverSigner` address (the public key of the key you keep on the server).
2. **Player wins chips** (tracked off-chain by the game server).
3. **Player requests withdrawal** (e.g. “Cash out 100 CHIP”):
   - Frontend calls your server: `POST /withdraw` with auth (JWT).
   - Server checks the player’s balance and nonce, then **signs a voucher** with `SIGNER_PRIVATE_KEY`:
     - Message = hash(chainId, vaultAddress, playerAddress, amount, nonce).
   - Server returns `{ amount, nonce, signature }` to the client.
4. **Player (or frontend) submits the withdrawal on-chain**:
   - The **player’s EOA** calls `vault.withdraw(amount, nonce, signature)`.
   - The contract checks that `signature` was produced by `serverSigner`.
   - If valid, the contract transfers tokens to **msg.sender** (the player) and marks the nonce used.

So:

- **Server:** Holds the signer **private** key only to create vouchers. It does not send transactions or hold funds.
- **User’s EOA:** Pays gas and is the one that calls `withdraw()` and receives the tokens.

The signer key is required so that only your game server can authorize who can withdraw and how much; the contract enforces that every withdrawal is backed by a valid server signature.
