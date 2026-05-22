# Borodutch Tools

Monorepo for public tools at tools.borodutch.com.

## Apps

- apps/frontend - Preact, TypeScript, Vite, and Tailwind frontend.
- contracts - Foundry Solidity contracts and tests.

## Commands

- bun install
- bun run dev
- bun run build
- bun run preview
- forge test

## Deployment

Easypanel should deploy this app with Nixpacks, not a Dockerfile.

The frontend includes the Base Sepolia $testcoin one-year lock flow. Configure it
with `VITE_BASE_SEPOLIA_TESTCOIN_ADDRESS` and `VITE_TESTCOIN_LOCK_ADDRESS`.
Deployment details for the lock contract live in
`docs/testcoin-locking-contract.md`.
