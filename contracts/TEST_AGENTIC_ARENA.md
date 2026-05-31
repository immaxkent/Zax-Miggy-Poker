# Agentic Arena — Foundry tests

Run arena-only tests (excludes legacy `ZaxAndMiggyVault`, `PokerVault`, `AgenticRankings` v1):

```bash
cd contracts
forge test --match-contract "AgenticArena|AgenticChips1155|AgenticRankingsV2|BotFactory|AgenticArenaTypes"
```

From repo root: `npm run test:arena`

## Test files

| File | Focus |
|------|--------|
| `test/helpers/AgenticArenaTestBase.sol` | Shared deploy + settlement builders |
| `test/AgenticArena.integration.t.sol` | End-to-end create → join → settle → burn |
| `test/AgenticArenaFees.t.sol` | Tier fees, treasury, elite gate |
| `test/AgenticArenaSettle.t.sol` | `settleGame` auth, hash, replay, access |
| `test/AgenticChips1155.t.sol` | Mint/burn, non-transferable, tokenId |
| `test/AgenticRankingsV2.t.sol` | Register, apply result, elite rank |
| `test/BotFactory.t.sol` | Arena-only deploy, bot ownership |
| `test/AgenticArenaTypes.t.sol` | Fee constants, settlement hash |
| `test/AgenticArena.unit.t.sol` | Legacy minimal unit (prefer files above) |

## Not covered yet (server / step b)

- Server builds `resultHash` matching `AgenticArenaTypes.hashSettlement`
- Server calls `settleGame` after arena DB finalize (no `closeGame`)

## Legacy tests to remove when redacting vault flow

- `test/ZaxAndMiggyVault.t.sol`
- `test/PokerVault.t.sol`
- `test/AgenticRankings.t.sol` (v1 vault-linked)
