import { describe, expect, it } from 'bun:test'
import type { EIP6963ProviderDetail } from 'mipd'
import type { EthereumProvider } from '../src/evm'
import { createEvmWalletStore, evmWalletsFromProviderDetails } from '../src/evm-wallets'

describe('EVM wallet discovery', () => {
  it('returns explicit EIP-6963 wallets instead of the raw legacy provider', () => {
    const legacy = ethereumProvider('legacy')
    const metamask = providerDetail('MetaMask', 'io.metamask', 'metamask-uuid', ethereumProvider('metamask'))
    const phantom = providerDetail('Phantom', 'app.phantom', 'phantom-uuid', ethereumProvider('phantom'))

    const wallets = evmWalletsFromProviderDetails([metamask, phantom], legacy)

    expect(wallets.map((wallet) => wallet.name)).toEqual(['MetaMask', 'Phantom'])
    expect(wallets.map((wallet) => wallet.source)).toEqual(['eip6963', 'eip6963'])
    expect(wallets[0]?.provider).toBe(metamask.provider)
    expect(wallets.some((wallet) => wallet.provider === legacy)).toBe(false)
  })

  it('falls back to window.ethereum when EIP-6963 providers are unavailable', () => {
    const legacy = ethereumProvider('legacy', { isMetaMask: true })

    const wallets = evmWalletsFromProviderDetails([], legacy)

    expect(wallets).toHaveLength(1)
    expect(wallets[0]).toMatchObject({
      id: 'legacy-window-ethereum',
      name: 'MetaMask',
      source: 'legacy',
    })
    expect(wallets[0]?.provider).toBe(legacy)
  })

  it('returns no wallets when neither EIP-6963 nor legacy injection exists', () => {
    expect(evmWalletsFromProviderDetails([])).toEqual([])
  })

  it('subscribes to EIP-6963 announcements and replaces the fallback wallet', () => {
    const legacy = ethereumProvider('legacy')
    const win = testWindow(legacy)
    const restoreWindow = installWindow(win)
    const store = createEvmWalletStore()
    const snapshots: ReturnType<typeof store.getWallets>[] = []

    try {
      const unsubscribe = store.subscribe((wallets) => snapshots.push(wallets), true)

      expect(snapshots.at(-1)?.[0]).toMatchObject({ name: 'Browser wallet', source: 'legacy' })

      const metamask = providerDetail('MetaMask', 'io.metamask', 'metamask-uuid', ethereumProvider('metamask'))
      win.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: metamask }))

      expect(snapshots.at(-1)).toHaveLength(1)
      expect(snapshots.at(-1)?.[0]).toMatchObject({
        id: 'metamask-uuid',
        name: 'MetaMask',
        rdns: 'io.metamask',
        source: 'eip6963',
      })
      expect(snapshots.at(-1)?.[0]?.provider).toBe(metamask.provider)

      unsubscribe()
    } finally {
      store.destroy()
      restoreWindow()
    }
  })
})

function ethereumProvider(label: string, flags: Partial<EthereumProvider> = {}): EthereumProvider {
  return {
    ...flags,
    request: async ({ method }) => `${label}:${method}`,
  }
}

function providerDetail(
  name: string,
  rdns: string,
  uuid: string,
  provider: EthereumProvider,
): EIP6963ProviderDetail {
  return {
    info: {
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
      name,
      rdns,
      uuid,
    },
    provider,
  }
}

function testWindow(ethereum: EthereumProvider) {
  const target = new EventTarget()

  return {
    ethereum,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  } as Window & { ethereum: EthereumProvider }
}

function installWindow(win: Window) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: win,
  })

  return () => {
    if (descriptor) {
      Object.defineProperty(globalThis, 'window', descriptor)
    } else {
      Reflect.deleteProperty(globalThis, 'window')
    }
  }
}
