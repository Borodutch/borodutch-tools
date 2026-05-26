# Borodutch Tools

Monorepo for public tools at tools.borodutch.com.

## Apps

- apps/frontend - Preact, TypeScript, Vite, and Tailwind frontend.
- apps/backend - Bun/TypeScript API that serves the frontend and processes $bdtch snapshot claims.
- contracts - Foundry Solidity contracts and tests.

The frontend exposes the production $BORO claim and lock surfaces on Base
mainnet, plus the confirmed Base mainnet token address. The Base Sepolia
$testcoin claim backend remains in the repo as an explicitly enabled
testnet/staging path, but it is not available in production.
The contracts package also includes the Base mainnet $BORO Merkle distributor.

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

## Base mainnet $BORO

The repo includes an upgradeable Base mainnet BOROTOKEN (`BORO`) contract,
deployment script, treasury-transfer script, an upgradeable BORO one-year lock,
and operator runbooks. See `docs/boro-mainnet-token.md` and
`docs/boro-locking-contract.md`.

Required deployment env:

- `BASE_MAINNET_RPC_URL`
- `BASE_MAINNET_DEPLOYER_PRIVATE_KEY`
- `BORO_INITIAL_RECIPIENT`
- `BORO_OWNER_OR_UPGRADE_ADMIN`
- `BORO_PROXY_ADDRESS`, `BORO_TREASURY_ADDRESS`, and
  `BORO_TREASURY_TRANSFER_AMOUNT_RAW` when transferring to treasury after
  deployment
- `BORO_TOKEN_ADDRESS`, and optionally `BORO_LOCK_OWNER` and
  `BORO_LOCK_DURATION_SECONDS` when deploying the BORO lock
- `VITE_BASE_MAINNET_BORO_ADDRESS` after the $BORO token address is confirmed
- `VITE_BORO_LOCK_ADDRESS` after the Base mainnet $BORO lock is deployed

Use only local ignored `.env` files or deployment secret managers for private
keys. Verify `.env` is ignored before adding real secrets:

```sh
git check-ignore .env .env.production
```

## $bdtch snapshot $BORO claim flow

The production claim backend lets a Solana $bdtch holder connect a Solana
wallet, enter a Base mainnet EVM recipient, sign a human-readable Solana
message, and submit that signed message to the backend. The backend verifies
the exact message bytes against the Solana public key, records the claim before
broadcasting, sends Base mainnet $BORO with an ERC20 `transfer`, and only marks
the claim sent after a successful transaction receipt. This reuses the original
centralized claim path with Base mainnet BORO runtime configuration.

Snapshot data is checked in at `apps/backend/data/bdtch-snapshot-2026-05-22.json`.

Snapshot facts:

- $bdtch mint: `5DwqxCS4CxMVZE3MXDvqpvQALFywLJkc4nG39K7hfWt4`
- Decimals: `6`
- Unique holders: `498`
- Supply captured raw: `999731086362116`
- Helius indexed slot: `421437667`

Allocation math uses raw integer values only:

```text
claimAmountRaw = floor(BORO_CLAIM_POOL_RAW * holderBdtchRaw / snapshotSupplyRaw)
```

Required runtime environment:

- Copy `.env.example` to a local `.env` for development, or set these values as deployment secrets.
- `.env` and `.env.*` files are ignored by git; keep real private keys out of tracked files.
- `DATABASE_URL`
- `BASE_MAINNET_RPC_URL`
- `BASE_MAINNET_BORO_ADDRESS`
- `BORO_CLAIM_SENDER_PRIVATE_KEY`
- `BORO_CLAIM_POOL_RAW`

Legacy Base Sepolia `$testcoin` claims are available only outside production
when `ENABLE_TESTNET_CLAIMS=true` is set deliberately. In that mode, the
backend uses `BASE_SEPOLIA_RPC_URL` or `ALCHEMY_BASE_SEPOLIA_API_KEY`,
`BASE_SEPOLIA_TESTCOIN_ADDRESS`, `BASE_SEPOLIA_AIRDROP_PRIVATE_KEY`, and
`TESTCOIN_CLAIM_POOL_RAW`. Production ignores `ENABLE_TESTNET_CLAIMS=true`
and continues to select the Base mainnet BORO claim config.

Production claim persistence requires Postgres. `NODE_ENV=production` fails startup
when `DATABASE_URL` is missing, and `ALLOW_IN_MEMORY_CLAIMS=true` is rejected in
production even when other claim env is present. For local development or tests
that intentionally do not use Postgres, set `ALLOW_IN_MEMORY_CLAIMS=true`
with `NODE_ENV` unset, `development`, or `test`; without that explicit opt-in,
the backend refuses to create an in-memory claim store.

Optional admin retry environment:

- `CLAIM_ADMIN_TOKEN` enables `POST /api/claim/admin/retry` with a bearer token or `x-admin-token` header. The body is `{ "claimId": "<claim-id>" }`, with optional `{ "allowMissingTxRetry": true }` only after an admin verifies a recorded transaction hash is stale or dropped. Only claims currently marked `failed` are retried. Before resending, the backend checks any recorded transaction hash and the recipient token balance; if the prior transfer already succeeded or the recipient balance already covers the claim, it recovers the claim without broadcasting again. Otherwise it moves the claim back to `pending` before broadcasting so concurrent retries do not send duplicates.

The backend creates these Postgres tables on startup: `claim_snapshots`, `holder_allocations`, `claim_challenges`, and `claims`. Uniqueness constraints prevent reused nonces, duplicate Solana-wallet claims, duplicate challenge claims, and reused EVM recipients.

Claim sends are serialized inside the backend process so concurrent claim
requests do not race the hot wallet nonce. The sender treats the persisted claim
id as an `idempotencyKey`: while the process is running, repeated sends for the
same key, recipient, and amount reuse the same in-flight or completed
transaction hash instead of broadcasting again. Reusing the same key for a
different transfer is rejected. Failed sends are not cached, so an explicit
retry/recovery path can attempt the same persisted claim again.

Private keys must only be supplied through deployment secrets. They must not be committed, exposed to the frontend, or logged.

Claim API rate limiting uses Bun's remote socket IP by default. Set `TRUST_PROXY_HEADERS=true` only when the deployment reverse proxy overwrites incoming client IP headers; with that flag enabled, the backend accepts normalized `cf-connecting-ip`, `true-client-ip`, `x-real-ip`, `forwarded`, or `x-forwarded-for` values for per-client rate-limit keys.

The production frontend reads `VITE_BASE_MAINNET_BORO_ADDRESS`,
`VITE_BORO_LOCK_ADDRESS`, and optionally `VITE_BASE_MAINNET_RPC_URL` /
`VITE_BORO_LOCK_MATURED_PAGE_SIZE`. The confirmed Base mainnet BORO token proxy
is the frontend default; set `VITE_BASE_MAINNET_BORO_ADDRESS` only to override
that public address.

## Deployment

Easypanel should deploy this app with Nixpacks, not a Dockerfile. Production should run:

```sh
bun install
bun run build
bun run start
```

`bun run start` launches the backend, which serves the built frontend from `apps/frontend/dist` and exposes `/api/claim/*`.

The frontend also includes the Base mainnet $BORO one-year lock flow. Configure
it with `VITE_BASE_MAINNET_BORO_ADDRESS` and `VITE_BORO_LOCK_ADDRESS`.
Do not configure legacy Base Sepolia `BASE_SEPOLIA_*` values for the normal
production service.
Deployment details for the lock contract live in `docs/boro-locking-contract.md`.

Base mainnet `$BORO` treasury claim distribution can also be operated as an
on-chain Merkle distributor later. Deployment and operator notes live in
`docs/boro-merkle-distributor.md`.
The full production launch checklist lives in `docs/boro-production-launch.md`.
Farcaster Mini App manifest, asset, and wallet behavior notes live in
`docs/farcaster-mini-app.md`.

Base mainnet `$BORO` locking uses an upgradeable one-year position contract.
Deployment, trust model, storage layout, and metadata notes live in
`docs/boro-locking-contract.md`.
