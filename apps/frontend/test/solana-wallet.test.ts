import { describe, expect, it } from 'bun:test'
import bs58 from 'bs58'
import {
  connectSolanaWallet,
  extractSignatureBytes,
  FARCASTER_SOLANA_UNSUPPORTED_MESSAGE,
  findSolanaWalletProvider,
  waitForSolanaWalletProvider,
} from '../src/solana-wallet'

describe('solana wallet provider discovery', () => {
  it('returns a friendly no-wallet error', async () => {
    const win = testWindow()

    await expect(connectSolanaWallet(win, 1)).rejects.toThrow('No Solana wallet found')
  })

  it('returns a precise Mini App fallback when the host has no Solana provider', async () => {
    const win = testWindow()

    await expect(connectSolanaWallet(win, 1, { miniAppMode: true })).rejects.toThrow(
      FARCASTER_SOLANA_UNSUPPORTED_MESSAGE,
    )
  })

  it('waits for delayed provider injection', async () => {
    const win = testWindow()
    const provider = injectedProvider('DelayedPublicKey')
    const pendingWallet = waitForSolanaWalletProvider(win, 500)

    setTimeout(() => {
      win.phantom = { solana: provider }
      win.dispatchEvent(new Event('phantom#initialized'))
    }, 10)

    const wallet = await pendingWallet

    expect(wallet).not.toBeNull()
    await expect(wallet?.connect()).resolves.toBe('DelayedPublicKey')
  })

  it('discovers Solana Wallet Standard providers', async () => {
    const win = testWindow()
    const pendingWallet = waitForSolanaWalletProvider(win, 500)

    setTimeout(() => {
      win.dispatchEvent(
        new CustomEvent('wallet-standard:register-wallet', {
          detail: standardWallet('StandardPublicKey', new Uint8Array([10, 11, 12])),
        }),
      )
    }, 10)

    const wallet = await pendingWallet

    expect(wallet?.label).toBe('Standard wallet')
    await expect(wallet?.connect()).resolves.toBe('StandardPublicKey')
    await expect(wallet?.signMessage('hello')).resolves.toEqual(new Uint8Array([10, 11, 12]))
  })

  it('connects with an injected provider public key', async () => {
    const win = testWindow()
    win.solana = injectedProvider('ConnectedPublicKey')

    const connected = await connectSolanaWallet(win)

    expect(connected.publicKey).toBe('ConnectedPublicKey')
  })

  it('connects and signs through the Farcaster Solana provider', async () => {
    const win = testWindow()
    const farcasterProvider = {
      request: async () => ({ publicKey: 'FarcasterPublicKey' }),
      signMessage: async () => ({ signature: btoa(String.fromCharCode(7, 8, 9)) }),
    }

    const connected = await connectSolanaWallet(win, 1, { farcasterProvider, miniAppMode: true })

    expect(connected.publicKey).toBe('FarcasterPublicKey')
    expect(connected.wallet.label).toBe('Farcaster Solana wallet')
    await expect(connected.wallet.signMessage('hello')).resolves.toEqual(new Uint8Array([7, 8, 9]))
  })

  it('prefers Farcaster Base64 signatures over ambiguous Base58 decoding', async () => {
    const win = testWindow()
    const signature = new Uint8Array([
      214, 5, 158, 228, 106, 123, 158, 7, 39, 234, 103, 193, 113, 55, 129, 92, 243, 242, 167, 219,
      92, 137, 199, 131, 197, 33, 209, 118, 226, 160, 40, 241, 134, 126, 54, 15, 1, 199, 140, 162,
      128, 75, 201, 187, 50, 195, 82, 231, 240, 52, 110, 225, 224, 91, 168, 23, 102, 124, 23, 125,
      93, 84, 56, 105,
    ])
    const ambiguousBase64 = '1gWe5Gp7ngcn6mfBcTeBXPPyp9tciceDxSHRduKgKPGGfjYPAceMooBLybsyw1Ln8DRu4eBbqBdmfBd9XVQ4aQ'
    const farcasterProvider = {
      request: async () => ({ publicKey: 'FarcasterPublicKey' }),
      signMessage: async () => ({ signature: ambiguousBase64 }),
    }

    const connected = await connectSolanaWallet(win, 1, { farcasterProvider, miniAppMode: true })

    await expect(connected.wallet.signMessage('hello')).resolves.toEqual(signature)
  })

  it('falls back to Base58 Farcaster signatures when Base64 does not decode to a signature', async () => {
    const win = testWindow()
    const signature = Uint8Array.from({ length: 64 }, (_, index) => index + 1)
    const farcasterProvider = {
      request: async () => ({ publicKey: 'FarcasterPublicKey' }),
      signMessage: async () => ({ signature: bs58.encode(signature) }),
    }

    const connected = await connectSolanaWallet(win, 1, { farcasterProvider, miniAppMode: true })

    await expect(connected.wallet.signMessage('hello')).resolves.toEqual(signature)
  })

  it('signs with injected providers that return direct signature bytes', async () => {
    const win = testWindow()
    win.solana = injectedProvider('ConnectedPublicKey', new Uint8Array([7, 8, 9]))

    const wallet = findSolanaWalletProvider(win)

    await expect(wallet?.signMessage('hello')).resolves.toEqual(new Uint8Array([7, 8, 9]))
  })

  it('signs with injected providers that return a signature object', async () => {
    const win = testWindow()
    win.phantom = { solana: injectedProvider('ConnectedPublicKey', { signature: new Uint8Array([4, 5, 6]) }) }

    const wallet = findSolanaWalletProvider(win)

    await expect(wallet?.signMessage('hello')).resolves.toEqual(new Uint8Array([4, 5, 6]))
  })

  it('extracts direct and object signature results', () => {
    const signature = new Uint8Array([1, 2, 3])

    expect(extractSignatureBytes(signature)).toEqual(signature)
    expect(extractSignatureBytes({ signature })).toEqual(signature)
  })
})

function testWindow() {
  const target = new EventTarget()
  const timers = globalThis

  return {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    setTimeout: timers.setTimeout.bind(timers),
    clearTimeout: timers.clearTimeout.bind(timers),
    setInterval: timers.setInterval.bind(timers),
    clearInterval: timers.clearInterval.bind(timers),
  } as Window & {
    phantom?: {
      solana?: ReturnType<typeof injectedProvider>
    }
    solana?: ReturnType<typeof injectedProvider>
  }
}

function injectedProvider(publicKey: string, signature: Uint8Array | { signature: Uint8Array } = { signature: new Uint8Array([4, 5, 6]) }) {
  return {
    isPhantom: true,
    publicKey: {
      toBase58: () => publicKey,
    },
    connect: async () => ({
      publicKey: {
        toBase58: () => publicKey,
      },
    }),
    signMessage: async () => signature,
  }
}

function standardWallet(address: string, signature: Uint8Array) {
  const account = {
    address,
    chains: ['solana:mainnet'],
  }

  return {
    name: 'Standard wallet',
    accounts: [account],
    features: {
      'standard:connect': {
        connect: async () => ({ accounts: [account] }),
      },
      'solana:signMessage': {
        signMessage: async () => ({ signature }),
      },
    },
  }
}
