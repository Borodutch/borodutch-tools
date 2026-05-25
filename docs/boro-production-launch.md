# $BORO production launch checklist

This runbook coordinates the final Base mainnet launch steps for
tools.borodutch.com. It intentionally records public addresses and transaction
hashes only. Keep private keys in ignored local env files or secure deployment
secrets, never in tickets, logs, PRs, or repo files.

## Current launch state

- Token: BOROTOKEN (`BORO`) on Base mainnet, chain id `8453`.
- Token proxy address:
  `0x91f11Ad8fa616E95b41C88dFFde95D415F3F9C3c`.
- Token implementation address:
  `0xC92736b9fEF54ECfe2A8B70Fc237793515D88324`.
- Initial supply: `1,000,000,000 BORO` minted once during token proxy
  initialization.
- Token deployer, initial recipient, and current owner/upgrade admin:
  `0x75DBd3d9d83baC30982627Dcbf3c0b46Ce001EA2`.
- Distribution wallet: `0xD991e2C2C7B2546e019192526100a148E087B7DC`.
- Lock proxy address:
  `0xfDD50a8eB2fc3Ef7325606aED1cf3FFBF3dC72e2`.
- Lock implementation address:
  `0x4086EE98cEE5929911EFbA6F77cc5c5E8b48b493`.
- Final lock upgrade/admin authority target:
  `0x75DBd3d9d83baC30982627Dcbf3c0b46Ce001EA2`.
- `tools.borodutch.com` currently serves the confirmed token address, but the
  lock card remains pending until the lock address source fallback or
  `VITE_BORO_LOCK_ADDRESS` is deployed.

## Launch order

1. Deploy the upgradeable `BORO` token from Nikita's funded Base mainnet
   deployer wallet using `docs/boro-mainnet-token.md`.
2. Record the token implementation address, proxy address, deployer, owner,
   initial recipient, tx hashes, block number, and Basescan links.
3. Set `VITE_BASE_MAINNET_BORO_ADDRESS` to the confirmed token proxy address
   and redeploy the frontend so the contract card links to Basescan and can be
   copied.
4. Transfer `900,000,000 BORO` plus Base ETH for gas to the distribution
   wallet after the token address and balances are verified.
5. Deploy the Base mainnet `$BORO` lock from the distribution wallet using
   `docs/boro-locking-contract.md`.
6. Transfer lock ownership/upgrade authority to
   `0x75DBd3d9d83baC30982627Dcbf3c0b46Ce001EA2`, then verify `owner()` on the
   lock proxy.
7. Set `VITE_BORO_LOCK_ADDRESS` to the confirmed lock proxy address and
   redeploy the frontend.
8. Deploy and fund the Merkle distributor using
   `docs/boro-merkle-distributor.md` after the final allocation/proof source is
   ready.
9. Verify production UI, contract links, token balances, distributor funding,
   claim proof lookup, and lock transactions before public launch.

## Frontend env

Set these as production frontend environment variables:

- `VITE_BASE_MAINNET_BORO_ADDRESS`: confirmed `$BORO` token proxy address.
- `VITE_BASE_MAINNET_RPC_URL`: Base mainnet RPC URL, defaults to
  `https://mainnet.base.org` when omitted.
- `VITE_BORO_LOCK_ADDRESS`: confirmed `$BORO` lock proxy address.
- `VITE_BORO_LOCK_MATURED_PAGE_SIZE`: optional matured-position read page
  size, defaults to `500`.

Do not set `VITE_BASE_MAINNET_BORO_ADDRESS` to a placeholder. The UI treats a
missing or zero address as pending so a fake contract address is never shown as
final.

Do not include legacy Base Sepolia `BASE_SEPOLIA_*` values in the normal
production service build args or runtime environment. The old `$testcoin` claim
API is disabled by default in production; only a deliberate staging/testnet
deployment should opt back in with `ENABLE_TESTNET_CLAIMS=true` and deployment
secrets.

## Required metadata to record

Token deployment:

- token implementation address:
  `0xC92736b9fEF54ECfe2A8B70Fc237793515D88324`
- token proxy address: `0x91f11Ad8fa616E95b41C88dFFde95D415F3F9C3c`
- deployer: `0x75DBd3d9d83baC30982627Dcbf3c0b46Ce001EA2`
- owner/upgrade admin: `0x75DBd3d9d83baC30982627Dcbf3c0b46Ce001EA2`
- initial recipient: `0x75DBd3d9d83baC30982627Dcbf3c0b46Ce001EA2`
- implementation deployment tx:
  `0x2eb290547af3885cf0e1c6084124d5f37dd9efcd5e7a8b1bd9025412ac0088e0`
- proxy deployment tx:
  `0xdb9774a611fa4e39c0987091bbb481a782684a999a1c0e2b12a6b99c5be570df`
- block number: `46478159`
- chain id `8453`
- Basescan verification status:
  - implementation:
    `https://basescan.org/address/0xC92736b9fEF54ECfe2A8B70Fc237793515D88324#code`
    is verified as `BoroToken`.
  - proxy:
    `https://basescan.org/address/0x91f11Ad8fa616E95b41C88dFFde95D415F3F9C3c#code`
    is verified as `ERC1967Proxy`.
  - proxy implementation relation: BaseScan links the proxy to
    `0xC92736b9fEF54ECfe2A8B70Fc237793515D88324` and shows `Read as Proxy` /
    `Write as Proxy`.
  - manual implementation verification parameters:
    `contracts/src/BoroToken.sol:BoroToken`, no constructor arguments,
    Solidity `v0.8.24+commit.e11b9ed9`, optimizer enabled, `200` runs, MIT
    license.
  - manual proxy verification parameters:
    `contracts/src/ERC1967Proxy.sol:ERC1967Proxy`, Solidity
    `v0.8.24+commit.e11b9ed9`, optimizer enabled, `200` runs, MIT license,
    constructor arguments:
    `000000000000000000000000c92736b9fef54ecfe2a8b70fc237793515d8832400000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000044485cc95500000000000000000000000075dbd3d9d83bac30982627dcbf3c0b46ce001ea200000000000000000000000075dbd3d9d83bac30982627dcbf3c0b46ce001ea200000000000000000000000000000000000000000000000000000000`.

Lock deployment and handoff:

- lock implementation address:
  `0x4086EE98cEE5929911EFbA6F77cc5c5E8b48b493`
- lock proxy address: `0xfDD50a8eB2fc3Ef7325606aED1cf3FFBF3dC72e2`
- deployer: `0xD991e2C2C7B2546e019192526100a148E087B7DC`
- token address: `0x91f11Ad8fa616E95b41C88dFFde95D415F3F9C3c`
- initial lock owner: `0x75DBd3d9d83baC30982627Dcbf3c0b46Ce001EA2`
- final lock owner: `0x75DBd3d9d83baC30982627Dcbf3c0b46Ce001EA2`
- lock duration: `31536000`
- implementation deployment tx:
  `0x4a606f614da6d1bc8000a3c969cb19ee913ea4a712bce7273b39705a751f00ac`
- proxy deployment tx:
  `0x80169f17cb4c3141e237d65e2f9403fe1f12ccd960feaba0b681c05142c9da11`
- ownership/authority handoff tx: not separate; owner was initialized directly
  to `0x75DBd3d9d83baC30982627Dcbf3c0b46Ce001EA2`
- block number: `46480179`
- chain id `8453`

Distribution:

- distribution wallet funding tx hashes
- distributor contract address
- Merkle root
- claim deadline
- funding amount
- funding tx hash
- distributor `$BORO` balance after funding

## Production verification

- `tools.borodutch.com` loads without Base Sepolia or `$testcoin` copy in the
  primary UI.
- The `$BORO` contract card shows the full confirmed Base mainnet address,
  copies it to the clipboard, and links to `basescan.org/token/<address>`.
- The claim card remains pending until the distributor and proof source are
  ready.
- The lock card remains pending until `VITE_BORO_LOCK_ADDRESS` is configured,
  then connects to Base mainnet and submits `$BORO` approvals/locks against the
  lock proxy.
- Basescan token, lock, funding, and handoff links all resolve to Base mainnet.
