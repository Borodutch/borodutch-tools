# Borodutch Tools

Monorepo for public tools at tools.borodutch.com.

## Apps

- apps/frontend - Preact, TypeScript, Vite, and Tailwind frontend.
- apps/backend - Bun/TypeScript API that serves the frontend and processes $bdtch snapshot claims.
- contracts - Foundry Solidity contracts and tests.

The frontend exposes tools through shared navigation. The current tools are the $bdtch snapshot claim flow and the Base Sepolia $testcoin one-year lock flow.

## Commands

- bun install
- bun run dev
- bun run dev:api
- bun run check
- bun run test
- bun run build
- bun run start
- bun run preview
- forge test

## $bdtch snapshot claim flow

The claim app lets a Solana $bdtch holder connect a Solana wallet, enter a Base Sepolia EVM recipient, sign a human-readable Solana message, and submit that signed message to the backend. The backend verifies the exact message bytes against the Solana public key, records the claim before broadcasting, and sends Base Sepolia $testcoin with an ERC20 `transfer`.

Snapshot data is checked in at `apps/backend/data/bdtch-snapshot-2026-05-22.json`.

Snapshot facts:

- $bdtch mint: `5DwqxCS4CxMVZE3MXDvqpvQALFywLJkc4nG39K7hfWt4`
- Decimals: `6`
- Unique holders: `498`
- Supply captured raw: `999731086362116`
- Helius indexed slot: `421437667`

Allocation math uses raw integer values only:

```text
claimAmountRaw = floor(TESTCOIN_CLAIM_POOL_RAW * holderBdtchRaw / snapshotSupplyRaw)
```

Required runtime environment:

- `DATABASE_URL`
- `BASE_SEPOLIA_RPC_URL` or `ALCHEMY_BASE_SEPOLIA_API_KEY`
- `BASE_SEPOLIA_TESTCOIN_ADDRESS`
- `BASE_SEPOLIA_AIRDROP_PRIVATE_KEY`
- `TESTCOIN_CLAIM_POOL_RAW`

The backend creates these Postgres tables on startup: `claim_snapshots`, `holder_allocations`, `claim_challenges`, and `claims`. Uniqueness constraints prevent reused nonces, duplicate Solana-wallet claims, duplicate challenge claims, and reused EVM recipients.

Private keys must only be supplied through deployment secrets. They must not be committed, exposed to the frontend, or logged.

The frontend lock view reads `VITE_BASE_SEPOLIA_TESTCOIN_ADDRESS`, `VITE_TESTCOIN_LOCK_ADDRESS`, and optionally `VITE_BASE_SEPOLIA_RPC_URL` / `VITE_TESTCOIN_LOCK_MATURED_PAGE_SIZE`.

## Deployment

Easypanel should deploy this app with Nixpacks, not a Dockerfile. Production should run:

```sh
bun install
bun run build
bun run start
```

`bun run start` launches the backend, which serves the built frontend from `apps/frontend/dist` and exposes `/api/claim/*`.

The frontend also includes the Base Sepolia $testcoin one-year lock flow.
Configure it with `VITE_BASE_SEPOLIA_TESTCOIN_ADDRESS` and
`VITE_TESTCOIN_LOCK_ADDRESS`. Deployment details for the lock contract live in
`docs/testcoin-locking-contract.md`.
