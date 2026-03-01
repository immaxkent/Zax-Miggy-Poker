# ERC-1155 Fractionalized Chips + Vault Integration — Proposal

## Goal

1. **Mint “chips” as ERC-1155** tied to a given NFT (collection + tokenId). Only the NFT owner can mint, so chips are **legitimate per account**.
2. **Deposit/withdraw those chips** in the existing PokerVault so the game can use them.

---

## 1. ChipToken (ERC-1155, fractionalized by NFT)

**Contract: `ChipToken.sol`**

- **Standard:** OpenZeppelin `ERC1155` (e.g. base URI `"https://api.game.com/chip/{id}.json"`).
- **Token ID:** Deterministic from backing NFT:
  ```text
  tokenId = uint256(keccak256(abi.encodePacked(collection, sourceTokenId)))
  ```
  So one “chip type” per (collection, tokenId). No need to register; first mint creates that type.
- **Mint:**
  - `mint(address collection, uint256 sourceTokenId, uint256 amount)`
  - Requires `IERC721(collection).ownerOf(sourceTokenId) == msg.sender`.
  - Mints `amount` of `tokenId(collection, sourceTokenId)` to `msg.sender`.
- **Optional:** `maxSupplyPerNft` (e.g. 1000) so each NFT can only back a cap of chips (true fractionalization).
- **Optional:** Allow only a whitelist of `collection` addresses so only “official” NFTs can back chips.

**Script: mint on creation / testing**

- **Option A — User flow:** Users call `ChipToken.mint(collection, sourceTokenId, amount)` themselves (no script).
- **Option B — Dev script:** `script/MintChips.s.sol` that:
  - Takes `CHIP_TOKEN_ADDRESS`, `COLLECTION`, `TOKEN_ID`, `AMOUNT` (from env or args).
  - Calls `ChipToken.mint(collection, tokenId, amount)` with `--sender` = NFT owner (e.g. deployer for local mock NFT).
- Use **Option B** for local/testing “mint on creation”; **Option A** for production.

---

## 2. PokerVault: receive chips and allow withdraw

**Current:** Vault holds ERC-20 only; `deposit(grossAmount)` / `withdraw(grossAmount, nonce, sig)`.

**Add:** ERC-1155 chip support **alongside** existing ERC-20 (no breaking change).

### 2.1 State and constructor

- Add: `IERC1155 public chipToken;` (can be `address(0)` = chip deposits disabled).
- Optional: set in constructor, or `setChipToken(address)` onlyOwner so we can deploy vault first and point to chips later.

### 2.2 Receiving chips (deposit)

- **Pull-based (primary):**  
  `depositChips(uint256 tokenId, uint256 amount)`  
  - Requires `chipToken != address(0)` and that `tokenId` is a valid chip type (e.g. we could allow any tokenId, or only those that have been minted at least once).  
  - `chipToken.safeTransferFrom(msg.sender, address(this), tokenId, amount)`.  
  - Credit: `depositedChips[msg.sender][tokenId] += amount`.  
  - Apply buy-in fee in the same way as ERC-20 (e.g. credit `amount - fee` for “playable” balance if you want fees on chip deposits; or no fee and 1:1 credit — your choice).

- **Push-based (optional):**  
  Implement **IERC1155Receiver** (e.g. inherit OpenZeppelin `ERC1155Holder`).  
  In `onERC1155Received(operator, from, id, value, data)`:  
  - If `from != address(0)`, treat as deposit: `depositedChips[from][id] += value`.  
  - Return the required selector so the transfer is accepted.  
  Then users can either call `depositChips(tokenId, amount)` or `chipToken.safeTransferFrom(user, vault, tokenId, amount, "")` and get credited.

### 2.3 Withdraw

- **Extend signed message to include token type:**  
  Server signs `(player, tokenId, amount, nonce)` (and chainId + contract address as today) so withdrawals are per chip type.
- **New function:**  
  `withdrawChips(uint256 tokenId, uint256 grossAmount, uint256 nonce, bytes calldata sig)`  
  - Recover signer from hash of `(chainId, vault, player, tokenId, grossAmount, nonce)`.  
  - Require `recovered == serverSigner`, `!usedNonces[player][nonce]`, and `depositedChips[player][tokenId] >= netAmount` (after fee).  
  - Deduct from `depositedChips[player][tokenId]`, mark nonce used, apply winner fee, then `chipToken.safeTransferFrom(address(this), player, tokenId, netAmount, "")`.

So:

- **Receive:** `depositChips(tokenId, amount)` + optional `onERC1155Received` to credit on direct `safeTransferFrom`.
- **Withdraw:** `withdrawChips(tokenId, grossAmount, nonce, sig)` with tokenId in the signed message.

No change to existing ERC-20 `deposit`/`withdraw`; they keep working as today.

---

## 3. Interfaces summary

| Contract     | Add / change |
|-------------|--------------|
| **ChipToken** | ERC1155, `mint(collection, sourceTokenId, amount)` with `ownerOf` check, deterministic `tokenId(collection, sourceTokenId)`. |
| **PokerVault** | `IERC1155 chipToken`; `depositChips(tokenId, amount)`; `withdrawChips(tokenId, grossAmount, nonce, sig)`; optional `IERC1155Receiver` (ERC1155Holder); `depositedChips[player][tokenId]`; withdraw hash includes `tokenId`. |

---

## 4. Deployment / script order

1. Deploy **ChipToken** (ERC-1155).
2. Deploy or reconfigure **PokerVault** with existing ERC-20 token and new `chipToken` address (or set later via `setChipToken`).
3. **Mint script:** For local/test: deploy a **MockERC721** (or use existing NFT), then run `MintChips.s.sol` with deployer as NFT owner to mint chips, then optionally call `depositChips` in the same script or separately.

---

## 5. Game / server impact (high level)

- **Buy-in:** If using chips, client calls `depositChips(tokenId, amount)` (or sends chips to vault and relies on `onERC1155Received`). Server credits the same player’s in-game stack using existing logic but keyed by chip type if you need it.
- **Cashout:** Server issues signed voucher including `tokenId`; client calls `withdrawChips(tokenId, amount, nonce, sig)`.

---

## 6. Optional: ERC-20 vs ERC-1155 only

- **Current:** Vault has one `token` (ERC-20) and one balance per player.
- **Proposed:** Add `chipToken` (ERC-1155) and **per–(player, tokenId)** balances. So you can support both “legacy” ERC-20 deposits and new chip deposits; withdraw uses the same signer and nonce space but different functions (ERC-20 vs ERC-1155) and different hash payloads (with/without `tokenId`).

If you later want to **only** use chips, you could:
- Set `token` to a dummy/unused address and only use `depositChips` / `withdrawChips`, or  
- Add a second “vault” that only deals in chips.  

For this proposal we only **add** chip support and leave ERC-20 as is.

---

## Sign-off

Once you’re happy with this shape (ChipToken mint by NFT ownership, vault receiving and withdrawing chips with tokenId in the signed message, optional receiver interface), we can implement:

1. `ChipToken.sol`
2. `PokerVault` changes (chipToken, depositChips, withdrawChips, optional ERC1155Holder, hash + nonce for chips)
3. `MintChips.s.sol` (and optional MockERC721 for local)
4. Deploy script updates (e.g. DeployLocal / DeploySepolia) to deploy ChipToken and set it on the vault

Say when to proceed and we’ll wire it in.
