# $BORO Base mainnet deployments

Canonical, git-tracked registry of deployed contract addresses and metadata.
Public addresses, tx hashes, and block numbers only — never private keys or RPC
URLs containing API keys.

- Chain: Base mainnet, chain id `8453`.
- Token deployer / initial recipient / upgrade admin:
  `0x75DBd3d9d83baC30982627Dcbf3c0b46Ce001EA2`.
- Lock deployer / distribution wallet:
  `0xD991e2C2C7B2546e019192526100a148E087B7DC`.

For every upgradeable contract, the **proxy** address is permanent and is what
users, the frontend, and integrations reference. The **implementation** address
changes on every UUPS upgrade — append a new row to "Upgrade history" each time.

## BORO token (`contracts/src/BoroToken.sol` behind `ERC1967Proxy`)

| Field | Value |
| --- | --- |
| Proxy address (permanent) | `0x91f11Ad8fa616E95b41C88dFFde95D415F3F9C3c` |
| Implementation (v1) | `0xC92736b9fEF54ECfe2A8B70Fc237793515D88324` |
| Initial recipient | `0x75DBd3d9d83baC30982627Dcbf3c0b46Ce001EA2` |
| Owner / upgrade admin | `0x75DBd3d9d83baC30982627Dcbf3c0b46Ce001EA2` |
| Deployer | `0x75DBd3d9d83baC30982627Dcbf3c0b46Ce001EA2` |
| Initial supply | `1,000,000,000 BORO` (`1e27` raw), fully minted to recipient |
| Proxy deploy tx | `0x2eb290547af3885cf0e1c6084124d5f37dd9efcd5e7a8b1bd9025412ac0088e0` |
| Implementation deploy tx | `0xdb9774a611fa4e39c0987091bbb481a782684a999a1c0e2b12a6b99c5be570df` |
| Deploy block | `46478159` |
| Basescan (proxy) | https://basescan.org/address/0x91f11Ad8fa616E95b41C88dFFde95D415F3F9C3c |
| Basescan (implementation) | https://basescan.org/address/0xC92736b9fEF54ECfe2A8B70Fc237793515D88324 |
| Verification artifacts | [`verification/base-mainnet/`](../verification/base-mainnet/README.md) |
| Verified on Basescan | Yes — proxy linked to implementation |

> Deployed and confirmed on Base mainnet. The proxy address is the permanent
> `$BORO` token address (set `VITE_BASE_MAINNET_BORO_ADDRESS` to it).

## BORO one-year lock (`contracts/src/BoroOneYearLock.sol` behind `ERC1967Proxy`)

| Field | Value |
| --- | --- |
| Proxy address (permanent) | `0xfDD50a8eB2fc3Ef7325606aED1cf3FFBF3dC72e2` |
| Implementation (v1) | `0x4086EE98cEE5929911EFbA6F77cc5c5E8b48b493` |
| Token address | `0x91f11Ad8fa616E95b41C88dFFde95D415F3F9C3c` |
| Deployer | `0xD991e2C2C7B2546e019192526100a148E087B7DC` |
| Initial lock owner | `0x75DBd3d9d83baC30982627Dcbf3c0b46Ce001EA2` |
| Final lock owner | `0x75DBd3d9d83baC30982627Dcbf3c0b46Ce001EA2` |
| Lock duration (seconds) | `31536000` |
| Implementation deploy tx | `0x4a606f614da6d1bc8000a3c969cb19ee913ea4a712bce7273b39705a751f00ac` |
| Proxy deploy tx | `0x80169f17cb4c3141e237d65e2f9403fe1f12ccd960feaba0b681c05142c9da11` |
| Ownership handoff tx hash | Not separate; owner was initialized directly to `0x75DBd3d9d83baC30982627Dcbf3c0b46Ce001EA2` |
| Deploy block | `46480179` |
| Basescan (proxy) | https://basescan.org/address/0xfDD50a8eB2fc3Ef7325606aED1cf3FFBF3dC72e2 |
| Basescan (implementation) | https://basescan.org/address/0x4086EE98cEE5929911EFbA6F77cc5c5E8b48b493 |
| Verification | Sourcify exact match; Blockscout proxy links to `BoroOneYearLock` implementation |

## BORO Merkle distributor (`contracts/src/BoroMerkleDistributor.sol`, not upgradeable)

| Field | Value |
| --- | --- |
| Address | TBD |
| Token address | TBD (BORO token proxy) |
| Owner | TBD |
| Merkle root | TBD |
| Claim deadline (unix) | TBD |
| Funded amount (raw) | TBD (must be >= sum of all leaf allocations) |
| Funding tx hash | TBD |
| Distributor BORO balance after funding | TBD |
| Deploy tx hash | TBD |
| Deploy block | TBD |

## Upgrade history

Append one row per UUPS upgrade of the token or lock proxy.

| Date | Contract | Proxy | New implementation | Upgrade tx | Notes |
| --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — |
