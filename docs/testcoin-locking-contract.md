# Base Sepolia $testcoin locking contract

`contracts/src/BaseSepoliaTestcoin.sol` is a fixed-supply Base Sepolia ERC20,
and `contracts/src/TestcoinOneYearLock.sol` locks that token for a fixed 365 day
cliff.

## Contract model

- `token` is immutable and set in the constructor.
- `lock(amount)` rejects zero amounts, records a new position, updates active
  totals, and then transfers `$testcoin` from the caller with a SafeERC20-style
  optional-return wrapper. It has no token address parameter, so the only
  supported lock path pulls the constructor-configured token.
- Plain ETH sends and calls to `lock(amount)` with `msg.value` revert with
  `UnsupportedAsset`; the contract does not attempt automatic refunds.
- `withdraw(positionId)` is owner-only, rejects early or repeated withdrawals,
  updates state before transferring tokens back, and uses a reentrancy guard.
- `withdrawMatured()` lets a user withdraw all of their currently matured active
  positions in one transaction.
- `totalLocked` and `lockedAmountOf(address)` are storage counters for active
  locked balances.
- `maturedLockedAmountOf(address)` computes the user's active positions whose
  `unlockAt <= block.timestamp`.
- `maturedLockedTotal(cursor, size)` pages over active position ids and computes
  the global matured-still-locked amount for the requested page.

The global matured amount is intentionally not stored as a simple counter:
maturity changes as time passes without a transaction. For the current test-scale
contract/UI, a paginated read over active positions is acceptable. If this grows
past small test-scale usage, index `Locked` and `Withdrawn` events in a backend
or subgraph and compute global reporting off-chain.

## Unsupported assets

The lock contract supports only the configured ERC20 token address. Do not add a
generic "lock any token" path around this contract.

ETH is intentionally unsupported. Both empty-calldata ETH transfers and
value-bearing `lock(amount)` calls revert before any position accounting or token
accounting can persist.

A standard ERC20 recipient cannot prevent someone from directly calling a
different token contract's `transfer(lockAddress, amount)`, because ERC20 has no
recipient hook. Those direct non-`$testcoin` transfers are not counted by
`totalLocked`, `lockedAmountOf`, or any position data, and the lock contract has
no callback surface for ERC721, ERC1155, or ERC777 tokens.

No rescue or sweep function is included. This keeps the deployed test lock free
of owner/admin powers over tokens at the lock address, but it also means
accidentally transferred unsupported ERC20s cannot be recovered from this
contract.

## Required env

Frontend:

- `VITE_BASE_SEPOLIA_TESTCOIN_ADDRESS`
- `VITE_TESTCOIN_LOCK_ADDRESS`
- `VITE_TESTCOIN_LOCK_MATURED_PAGE_SIZE` optional, defaults to `500`

Deployment:

- `BASE_SEPOLIA_RPC_URL` or equivalent Foundry RPC alias
- `BASE_SEPOLIA_TESTCOIN_ADDRESS`
- `TESTCOIN_INITIAL_SUPPLY_RAW` when deploying the token and lock together
- deployment private key supplied to Foundry through a secret manager or shell
  environment

Do not put private keys in source, frontend env, deployment metadata, or logs.

## Deploy

Token plus lock:

```sh
forge script contracts/script/DeployTestcoinAndLock.s.sol \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --private-key "$BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY" \
  --broadcast
```

Lock only, when the token already exists:

```sh
forge script contracts/script/DeployTestcoinOneYearLock.s.sol \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --private-key "$BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  --verify
```

Store this metadata after deployment:

- token address
- locking contract address
- deployer address
- deployment transaction hash
- chain id `84532`
- block number

## Base Sepolia production deployment 2026-05-23

- token: `0x763c030fc5c0db724855123c37cfa36631116f59`
- lock contract: `0x8824d182e1dd2d3aeadbfc45beaa374067c11dee`
- deployer: `0xC2142A4918754abe5975ecD486A66DfeBA39A419`
- token supply: `1000000000000000000000000000`
- token deployment tx: `0x7024b7b0444e81732b66b148a446027e60e92a056ded22aba094880b271f0410`
- lock deployment tx: `0x7f83f8f7f0cc27e050d12a9c750fd8518450720c258ec9e2674a507157d44aa6`
- chain id: `84532`

Smoke-tested earlier deployment:

- token: `0xc2f48ed979e106e2feeb5acd0fe721daf5f33adf`
- lock contract: `0x0f053b5b292292e3433ee7d24131afdc1729ec4b`
- lock smoke tx: `0x8dcf2b8ca1e62103958a2fbba83d0fe42fbe8824824fe2b6bb125008cf184357`

## Validation

```sh
forge test
bun run build
```
