import { createStore, type EIP6963ProviderDetail, type Store } from 'mipd'
import type { EthereumProvider } from './evm'

export type EvmWallet = {
  icon?: string
  id: string
  name: string
  provider: EthereumProvider
  rdns?: string
  source: 'eip6963' | 'legacy'
}

export type EvmWalletStore = {
  destroy(): void
  getWallets(): EvmWallet[]
  subscribe(listener: (wallets: EvmWallet[]) => void, emitImmediately?: boolean): () => void
}

export function createEvmWalletStore(legacyProvider = window.ethereum): EvmWalletStore {
  const store = createStore()

  return {
    destroy() {
      store.destroy()
    },
    getWallets() {
      return evmWalletsFromProviderDetails(store.getProviders(), legacyProvider)
    },
    subscribe(listener, emitImmediately = false) {
      return subscribeToWalletStore(store, legacyProvider, listener, emitImmediately)
    },
  }
}

export function evmWalletsFromProviderDetails(
  providerDetails: readonly EIP6963ProviderDetail[],
  legacyProvider?: EthereumProvider,
): EvmWallet[] {
  const announcedWallets = providerDetails.map(({ info, provider }) => ({
    icon: info.icon,
    id: info.uuid,
    name: info.name,
    provider: provider as EthereumProvider,
    rdns: info.rdns,
    source: 'eip6963' as const,
  }))

  if (announcedWallets.length > 0) return announcedWallets

  return legacyProvider
    ? [
        {
          id: 'legacy-window-ethereum',
          name: legacyProviderName(legacyProvider),
          provider: legacyProvider,
          source: 'legacy',
        },
      ]
    : []
}

function subscribeToWalletStore(
  store: Store,
  legacyProvider: EthereumProvider | undefined,
  listener: (wallets: EvmWallet[]) => void,
  emitImmediately: boolean,
) {
  return store.subscribe(() => listener(evmWalletsFromProviderDetails(store.getProviders(), legacyProvider)), {
    emitImmediately,
  })
}

function legacyProviderName(provider: EthereumProvider): string {
  if ('isMetaMask' in provider && provider.isMetaMask) return 'MetaMask'
  if ('isPhantom' in provider && provider.isPhantom) return 'Phantom'
  return 'Browser wallet'
}
