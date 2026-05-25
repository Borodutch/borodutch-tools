# Base mainnet verification artifacts

Everything needed to verify the deployed `$BORO` contracts on Basescan (or any
explorer), committed so verification never depends on a local build. Chain id
`8453`.

## Compiler settings (enter these exactly on Basescan)

- Solidity version: **v0.8.24**
- EVM version: **cancun**
- Optimizer: **enabled**, **200** runs
- Verification method: **Solidity (Standard-JSON-Input)**

## BORO token implementation

- Contract: `contracts/src/BoroToken.sol:BoroToken`
- Address: `0xC92736b9fEF54ECfe2A8B70Fc237793515D88324`
- Standard JSON input: [`BoroToken.standard-input.json`](./BoroToken.standard-input.json)
- Constructor args: **none**
- Deploy tx: `0xdb9774a611fa4e39c0987091bbb481a782684a999a1c0e2b12a6b99c5be570df`

## BORO token proxy (permanent token address)

- Contract: `contracts/src/ERC1967Proxy.sol:ERC1967Proxy`
- Address: `0x91f11Ad8fa616E95b41C88dFFde95D415F3F9C3c`
- Standard JSON input: [`ERC1967Proxy.standard-input.json`](./ERC1967Proxy.standard-input.json)
- Constructor args (abi-encoded, no `0x`): [`ERC1967Proxy.constructor-args.txt`](./ERC1967Proxy.constructor-args.txt)
  - Decoded: `implementation = 0xC92736b9fEF54ECfe2A8B70Fc237793515D88324`,
    `data = initialize(0x75DBd3d9d83baC30982627Dcbf3c0b46Ce001EA2, 0x75DBd3d9d83baC30982627Dcbf3c0b46Ce001EA2)`
- Deploy tx: `0x2eb290547af3885cf0e1c6084124d5f37dd9efcd5e7a8b1bd9025412ac0088e0`

After both are verified, on the proxy address use Basescan's **"Is this a
proxy?"** detector so the read/write-as-proxy tabs expose the token functions.

## Regenerating these artifacts

```sh
forge verify-contract <addr> contracts/src/BoroToken.sol:BoroToken --show-standard-json-input
forge verify-contract <addr> contracts/src/ERC1967Proxy.sol:ERC1967Proxy --show-standard-json-input
cast abi-encode "constructor(address,bytes)" <impl> <initData>
```
