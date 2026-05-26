# Farcaster Mini App

`tools.borodutch.com` publishes Farcaster Mini App discovery data from the frontend static assets:

- `/.well-known/farcaster.json`
- `/farcaster/icon.png` - 1024x1024 PNG, no alpha
- `/farcaster/splash.png` - 200x200 PNG, no alpha
- `/farcaster/frame.png` - 1200x800 PNG, 3:2 Mini App embed image

The root HTML includes both `fc:miniapp` and backward-compatible `fc:frame` metadata. The embed button title is `Claim $BORO` and launches `https://tools.borodutch.com/?miniApp=true`, which lets the app skip the X embed and call the Farcaster SDK `ready` action as soon as the UI is interactive.

## Account association

The manifest includes the signed `accountAssociation` for `tools.borodutch.com`. If the app ownership changes or the domain migrates:

1. Open `https://farcaster.xyz/~/developers/new` while signed in to the owning Farcaster account.
2. Enter the domain exactly as `tools.borodutch.com`.
3. Generate the signed account association.
4. Replace the existing `accountAssociation` object in `apps/frontend/public/.well-known/farcaster.json`.
5. Redeploy and verify `https://tools.borodutch.com/.well-known/farcaster.json` returns the signed object.

If using Farcaster Hosted Manifests instead, create the hosted manifest at `https://farcaster.xyz/~/developers/mini-apps/manifest`, copy the hosted manifest ID, and replace the static manifest route with a `307` redirect to `https://api.farcaster.xyz/miniapps/hosted-manifest/<hosted-manifest-id>`.

## Wallet behavior

Inside a Mini App, the lock flow adds `sdk.wallet.getEthereumProvider()` as the `Farcaster Wallet` EIP-1193 option. Normal web browsers keep the existing EIP-6963 and legacy injected wallet picker.

For Solana claims, the app uses `sdk.wallet.getSolanaProvider()` when the Farcaster host provides it. If the host does not expose Solana, the claim flow shows a precise fallback message telling the user to open the site in a browser with Phantom, Solflare, or Backpack.
