# Base mainnet $BORO token deployment

`contracts/src/BoroToken.sol` is the upgradeable Base mainnet ERC20 for
BOROTOKEN (`BORO`). It is deployed behind the repo-local ERC1967 proxy in
`contracts/src/ERC1967Proxy.sol`.

## Contract model

- Token display name: `BOROTOKEN`.
- Symbol: `BORO`.
- Decimals: `18`.
- Initial supply: `1,000,000,000 BORO`
  (`1000000000000000000000000000` raw units).
- The initial supply is minted once during proxy initialization to
  `BORO_INITIAL_RECIPIENT`.
- There is no public or owner-only mint function after initialization.
- `BORO_OWNER_OR_UPGRADE_ADMIN` controls ownership transfer and UUPS upgrades
  through `upgradeToAndCall`.
- Upgrades must point to an implementation whose `proxiableUUID()` matches the
  ERC1967 implementation slot.
- The deployment and treasury-transfer scripts refuse any chain except Base
  mainnet chain id `8453`.

The treasury/distributor contract is intentionally not bundled here. If the
$BORO treasury is not ready at deploy time, mint the 1B BORO to the fresh
deployer wallet, then transfer the intended amount to the treasury after that
address is approved.

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
- `BORO_INITIAL_RECIPIENT`
- `BORO_OWNER_OR_UPGRADE_ADMIN`

Optional treasury-transfer variables:

- `BORO_PROXY_ADDRESS`
- `BORO_TREASURY_ADDRESS`
- `BORO_TREASURY_TRANSFER_AMOUNT_RAW`

Use a fresh funded Base mainnet deployer wallet. If the treasury address is
known and reviewed before deploy, the safer path is to set
`BORO_INITIAL_RECIPIENT` directly to that treasury. If the treasury is not ready,
set `BORO_INITIAL_RECIPIENT` to the fresh deployer wallet and transfer later with
the separate treasury script.

## Install and test

```sh
bun install
bun run check
bun run test
bun run build
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
forge script contracts/script/DeployBoroMainnet.s.sol:DeployBoroMainnet \
  --rpc-url "$BASE_MAINNET_RPC_URL" \
  --private-key "$BASE_MAINNET_DEPLOYER_PRIVATE_KEY"
```

The script reverts unless the RPC reports chain id `8453`.

## Broadcast

```sh
forge script contracts/script/DeployBoroMainnet.s.sol:DeployBoroMainnet \
  --rpc-url "$BASE_MAINNET_RPC_URL" \
  --private-key "$BASE_MAINNET_DEPLOYER_PRIVATE_KEY" \
  --broadcast
```

Add `--verify --etherscan-api-key "$BASESCAN_API_KEY"` when verification
credentials are available.

## Treasury transfer

Prefer direct minting to the reviewed treasury by setting
`BORO_INITIAL_RECIPIENT=$BORO_TREASURY_ADDRESS` before deployment. If the deployer
wallet receives the initial supply first, transfer only after the treasury
address is approved:

```sh
forge script contracts/script/TransferBoroToTreasury.s.sol:TransferBoroToTreasury \
  --rpc-url "$BASE_MAINNET_RPC_URL" \
  --private-key "$BASE_MAINNET_DEPLOYER_PRIVATE_KEY" \
  --broadcast
```

For the full 1B BORO supply, set:

```text
BORO_TREASURY_TRANSFER_AMOUNT_RAW=1000000000000000000000000000
```

## Deployment metadata

Persist this metadata after deployment:

- implementation address
- proxy address
- upgrade owner/admin address
- deployer address
- initial recipient address
- deployment transaction hashes
- block number
- chain id `8453`
- verification URLs, if verified

Persist this metadata after a treasury transfer:

- BORO proxy address
- treasury address
- transfer amount raw
- transfer transaction hash
- block number
- chain id `8453`
