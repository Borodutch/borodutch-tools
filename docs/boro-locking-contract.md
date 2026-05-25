# Base mainnet $BORO locking contract

`contracts/src/BoroOneYearLock.sol` is the upgradeable Base mainnet lock
contract for BOROTOKEN (`BORO`). It is deployed behind the repo-local ERC1967
proxy in `contracts/src/ERC1967Proxy.sol`.

## Contract model

- Accepted lock asset: the configured `BORO_TOKEN_ADDRESS` ERC20 only.
- Upgrade pattern: UUPS-style implementation with `proxiableUUID()` and
  `upgradeToAndCall()`.
- Initial upgrade authority: the fresh funded deployer wallet derived from
  `BASE_MAINNET_DEPLOYER_PRIVATE_KEY`, unless `BORO_LOCK_OWNER` is explicitly
  set.
- Minimum lock duration: `365 days`.
- Configured lock duration: `BORO_LOCK_DURATION_SECONDS`, defaulting to
  `365 days`; the initializer rejects shorter durations.
- `lock(amount)` transfers BORO from the caller to the proxy using safe ERC20
  transfer handling. `amount == 0` reverts.
- Every lock creates a position with owner, amount, lock timestamp, unlock
  timestamp, and withdrawn flag.
- `withdraw(positionId)` releases one matured position to its owner only.
- `withdrawMatured()` releases all currently matured positions for the caller.
- Direct ETH sends revert. The supported user path is ERC20 approval plus
  `lock(amount)`.
- There is no admin sweep, pause, forced withdrawal, or arbitrary transfer
  function. The owner cannot directly move locked user BORO.

The lock mirrors the Base Sepolia `$testcoin` one-year position model, but it is
upgradeable and targets the real Base mainnet BORO token. Existing positions
store their own `unlockAt`, so changing future code cannot alter timestamps
already written without an explicit upgrade that changes storage or withdrawal
logic.

## Visibility

The contract exposes:

- `token()`
- `owner()`
- `lockDuration()`
- `nextPositionId()`
- `totalLocked()`
- `lockedAmountOf(address)`
- `positions(positionId)`
- `positionIdsOf(address)`
- `getPositionIds(address,cursor,size)`
- `activePositionCount()`
- `activePositionIdAt(index)`
- `maturedLockedAmountOf(address)`
- `maturedLockedTotal(cursor,size)`

Global matured amount is page-based because maturity changes with time without a
transaction. Indexers or operators should page through active positions instead
of expecting a permanently current storage counter.

## Trust model

The deployer controls upgrades by default. If `BORO_LOCK_OWNER` is set, that
address controls upgrades instead. The current implementation has no admin path
to steal locked user funds, but an upgrade authority can deploy new logic that
changes withdrawal rules, accounting, or custody behavior. Treat the owner as a
mainnet privileged role and transfer it only to a reviewed multisig or governance
address when operationally ready.

Future implementations must preserve the existing storage layout:

1. `_initialized`
2. `_status`
3. `token`
4. `owner`
5. `lockDuration`
6. `nextPositionId`
7. `totalLocked`
8. `positions`
9. `lockedAmountOf`
10. `_ownerPositionIds`
11. `_activePositionIds`
12. `_activePositionIndex`

Append new storage after the current fields. Do not reorder, remove, rename
with different types, or insert fields before existing variables.

## Required env

Create a local `.env` file or use deployment secrets. Do not put real private
keys in tracked files, docs, frontend env, deployment metadata, or logs.

Before writing real secrets, verify local env files are ignored:

```sh
git check-ignore .env .env.production
git check-ignore -v .env .env.production
```

Required deployment variables:

- `BASE_MAINNET_RPC_URL`
- `BASE_MAINNET_DEPLOYER_PRIVATE_KEY`
- `BORO_TOKEN_ADDRESS`

Optional deployment variables:

- `BORO_LOCK_OWNER` defaults to the deployer wallet derived from
  `BASE_MAINNET_DEPLOYER_PRIVATE_KEY`
- `BORO_LOCK_DURATION_SECONDS` defaults to `31536000`
- `BASESCAN_API_KEY` for verification

## Install and test

```sh
bun install
forge fmt --check
forge test
```

## Dry run

Load local env only in your shell session:

```sh
set -a
. ./.env
set +a
```

Simulate deployment on Base mainnet without broadcasting:

```sh
forge script contracts/script/DeployBoroOneYearLock.s.sol:DeployBoroOneYearLock \
  --rpc-url "$BASE_MAINNET_RPC_URL" \
  --private-key "$BASE_MAINNET_DEPLOYER_PRIVATE_KEY"
```

The script reverts unless the RPC reports chain id `8453`.

## Broadcast

```sh
forge script contracts/script/DeployBoroOneYearLock.s.sol:DeployBoroOneYearLock \
  --rpc-url "$BASE_MAINNET_RPC_URL" \
  --private-key "$BASE_MAINNET_DEPLOYER_PRIVATE_KEY" \
  --broadcast
```

Add verification when credentials are available:

```sh
forge script contracts/script/DeployBoroOneYearLock.s.sol:DeployBoroOneYearLock \
  --rpc-url "$BASE_MAINNET_RPC_URL" \
  --private-key "$BASE_MAINNET_DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  --verify \
  --etherscan-api-key "$BASESCAN_API_KEY"
```

## Check owner and implementation

After deployment, read the proxy as `BoroOneYearLock`:

```sh
cast call "$BORO_LOCK_PROXY_ADDRESS" "owner()(address)" --rpc-url "$BASE_MAINNET_RPC_URL"
cast call "$BORO_LOCK_PROXY_ADDRESS" "token()(address)" --rpc-url "$BASE_MAINNET_RPC_URL"
cast call "$BORO_LOCK_PROXY_ADDRESS" "lockDuration()(uint256)" --rpc-url "$BASE_MAINNET_RPC_URL"
cast call "$BORO_LOCK_PROXY_ADDRESS" "implementation()(address)" --rpc-url "$BASE_MAINNET_RPC_URL"
```

The last command uses the proxy's helper and should return the implementation
address.

## Transfer upgrade ownership

Only transfer ownership after the new owner address is reviewed, backed up, and
able to sign Base mainnet transactions. Prefer a multisig.

Safety checklist:

- Confirm `BORO_LOCK_PROXY_ADDRESS` is the proxy, not the implementation.
- Confirm the new owner address is on Base mainnet and controlled by the intended
  signer set.
- Confirm no pending upgrade or operational action depends on the deployer owner.
- Record the transaction hash and update deployment metadata.

Command:

```sh
cast send "$BORO_LOCK_PROXY_ADDRESS" "transferOwnership(address)" "$NEW_BORO_LOCK_OWNER" \
  --rpc-url "$BASE_MAINNET_RPC_URL" \
  --private-key "$BASE_MAINNET_DEPLOYER_PRIVATE_KEY"
```

Then verify:

```sh
cast call "$BORO_LOCK_PROXY_ADDRESS" "owner()(address)" --rpc-url "$BASE_MAINNET_RPC_URL"
```

## Deployment metadata

Persist this metadata after deployment:

- implementation address
- proxy address
- proxy admin/upgrade authority owner
- deployer address
- BORO token address
- lock duration seconds
- deployment transaction hashes
- block number
- chain id `8453`
- verification URLs, if verified

Persist this metadata after ownership transfer:

- previous owner
- new owner
- transfer transaction hash
- block number
- chain id `8453`
