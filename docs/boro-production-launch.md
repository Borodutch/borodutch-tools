# $BORO production launch checklist

This runbook coordinates the final Base mainnet launch steps for
tools.borodutch.com. It intentionally records public addresses and transaction
hashes only. Keep private keys in ignored local env files or secure deployment
secrets, never in tickets, logs, PRs, or repo files.

## Current launch state

- Token: BOROTOKEN (`BORO`) on Base mainnet, chain id `8453`.
- Initial supply: `1,000,000,000 BORO` minted once during token proxy
  initialization.
- Distribution wallet: `0xD991e2C2C7B2546e019192526100a148E087B7DC`.
- Final lock upgrade/admin authority target:
  `0x75DBd3d9d83baC30982627Dcbf3c0b46Ce001EA2`.
- `tools.borodutch.com` shows the token contract as pending until
  `VITE_BASE_MAINNET_BORO_ADDRESS` is set to the confirmed Base mainnet token
  address.

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

## Required metadata to record

Token deployment:

- token implementation address
- token proxy address
- deployer
- owner/upgrade admin
- initial recipient
- deployment tx hashes
- block number
- chain id `8453`
- Basescan verification URLs, if verified

Lock deployment and handoff:

- lock implementation address
- lock proxy address
- deployer
- token address
- initial lock owner
- final lock owner
- deployment tx hashes
- ownership/authority handoff tx hashes
- block number
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
