# $BORO Merkle distributor

`contracts/src/BoroMerkleDistributor.sol` is the on-chain treasury claim
alternative for Base mainnet $BORO. The active production path currently reuses
the signed Solana holder -> Base recipient backend hot-wallet flow documented in
the repository README.

## Design decision

Use an on-chain Merkle distributor instead of a centralized backend treasury
wallet for mainnet $BORO claims.

Tradeoffs:

- On-chain custody keeps the $BORO supply in a contract, not a backend hot key.
- The Merkle root publicly commits to `(baseRecipient, amountRaw)` allocations.
- Double-claim prevention is enforced by contract state and is independently
  inspectable.
- Users pay their own Base gas to claim.
- Allocation generation still happens off-chain, because the original holder set
  is a Solana `$bdtch` snapshot and Base contracts cannot verify arbitrary
  Solana wallet ownership directly.

The centralized backend pattern used for Base Sepolia `$testcoin` is useful for
testing and subsidized claims, but it depends on backend nonce/finality/retry
logic and production key management. That is a weaker custody model for mainnet
treasury distribution.

## Contract model

- `token` is the deployed Base mainnet `$BORO` ERC20.
- `merkleRoot` is immutable. Root updates are intentionally not supported, so an
  admin cannot rewrite allocations after deployment.
- Leaves are `keccak256(bytes.concat(keccak256(abi.encode(account, amount))))`.
  The tree uses sorted pair hashing, matching OpenZeppelin Standard Merkle Tree
  style double-hashed leaves.
- `claim(amount, proof)` transfers `amount` to `msg.sender` when the proof
  verifies `(msg.sender, amount)` and the address has not claimed before.
- `hasClaimed(account)` prevents double claims.
- `Claimed(account, amount)` is emitted for successful claims.
- The distributor is funded by transferring `$BORO` to the contract address
  before claims open.
- `withdrawExpired(to, amount)` lets the immutable `owner` recover unclaimed
  tokens only after `claimDeadline`. There is no pre-deadline emergency
  withdrawal, and there is no root update path.

## Allocation mapping

The existing `$bdtch` snapshot allocation rule should be reused with `$BORO` as
the claim pool:

```text
boroClaimAmountRaw = floor(BORO_CLAIM_POOL_RAW * holderBdtchRaw / snapshotSupplyRaw)
```

Use raw integer values only. `$BORO` uses 18 decimals, so
`BORO_CLAIM_POOL_RAW` for 1,000,000,000 BORO is:

```text
1000000000000000000000000000
```

Because the snapshot holder addresses are Solana addresses, a final Merkle input
file must bind each eligible Solana holder to a Base recipient address before
root generation. The existing signed-message claim flow already demonstrates the
safe binding pattern: the Solana wallet signs a message that includes the exact
Base recipient. For mainnet, produce an audited final CSV/JSON with at least:

- Solana holder address
- holder `$bdtch` raw balance
- Base recipient address
- `$BORO` claim amount raw
- Solana signature or review evidence for the binding

The deployed Merkle tree should include only `(baseRecipient, boroClaimAmountRaw)`.
Do not include private keys or secrets in allocation files.

## Deployment env

Use a local `.env` or deployment secret file that is ignored by git. Never commit
private keys. Verify `.env` is ignored before writing real deployment secrets.

Required:

- `BASE_MAINNET_RPC_URL`
- `BASE_MAINNET_DEPLOYER_PRIVATE_KEY`
- `BASE_MAINNET_BORO_ADDRESS`
- `BORO_MERKLE_ROOT`
- `BORO_DISTRIBUTOR_OWNER`
- `BORO_CLAIM_DEADLINE` as a Unix timestamp

The deploy script refuses any chain other than Base mainnet chain id `8453`.

## Deploy

Dry run:

```sh
forge script contracts/script/DeployBoroMerkleDistributor.s.sol \
  --rpc-url "$BASE_MAINNET_RPC_URL" \
  --private-key "$BASE_MAINNET_DEPLOYER_PRIVATE_KEY"
```

Broadcast:

```sh
forge script contracts/script/DeployBoroMerkleDistributor.s.sol \
  --rpc-url "$BASE_MAINNET_RPC_URL" \
  --private-key "$BASE_MAINNET_DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  --verify
```

After deployment, transfer the intended `$BORO` claim pool to the distributor
contract. Confirm:

- distributor address
- `$BORO` token address
- Merkle root
- owner
- claim deadline
- deployment tx hash
- funding tx hash
- block number
- chain id `8453`
- distributor `$BORO` balance equals the intended claim pool

## Claim flow

1. Publish the allocation/proof file or API that returns a proof for the
   connected Base address.
2. User connects the Base recipient wallet.
3. UI calls `claim(amount, proof)` from that same address.
4. Contract transfers `$BORO` to the caller and emits `Claimed`.

Claims cannot be marked complete by a backend unless the on-chain transaction is
confirmed. The contract is the source of truth for claim status.

## Validation

```sh
forge fmt --check
forge test
```
