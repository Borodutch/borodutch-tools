# Base Sepolia $testcoin locking contract

`contracts/src/BaseSepoliaTestcoin.sol` is a fixed-supply Base Sepolia ERC20,
and `contracts/src/TestcoinOneYearLock.sol` locks that token for a fixed 365 day
cliff.

## Contract model

- `token` is immutable and set in the constructor.
- `lock(amount)` rejects zero amounts, records a new position, updates active
  totals, and then transfers `$testcoin` from the caller with a SafeERC20-style
  optional-return wrapper.
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

## Base Sepolia deployment 2026-05-23

- token: `0xc2f48ed979e106e2feeb5acd0fe721daf5f33adf`
- lock contract: `0x0f053b5b292292e3433ee7d24131afdc1729ec4b`
- deployer: `0xC2142A4918754abe5975ecD486A66DfeBA39A419`
- token supply: `1000000000000000000000000000`
- token deployment tx: `0xfd065f9f2623e50440242b8e6e3503c4a1fd07a8080825d6527ae445df56669e`
- lock deployment tx: `0x74b38962126c3d9463c351c961e6e8d62bb1098a8ed5a18d1543ea08d32f51ef`
- chain id: `84532`

## Validation

```sh
forge test
bun run build
```
