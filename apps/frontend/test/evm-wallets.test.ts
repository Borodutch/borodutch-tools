import { describe, expect, it } from 'bun:test'
import { connectWallet, getEvmWalletOptions, type EthereumProvider } from '../src/evm'

describe('EVM wallet provider discovery', () => {
  it('uses EIP-6963 providers as separate wallet choices', () => {
    const metamask = provider({ isMetaMask: true })
    const phantom = provider({ isPhantom: true })

    const options = getEvmWalletOptions(
      {},
      [
        {
          info: {
            icon: 'data:image/svg+xml,<svg />',
            name: 'MetaMask',
            rdns: 'io.metamask',
            uuid: 'metamask-uuid',
          },
          provider: metamask,
        },
        {
          info: {
            icon: 'data:image/svg+xml,<svg />',
            name: 'Phantom',
            rdns: 'app.phantom',
            uuid: 'phantom-uuid',
          },
          provider: phantom,
        },
      ],
    )

    expect(options.map((option) => option.name)).toEqual(['MetaMask', 'Phantom'])
    expect(options[0]?.provider).toBe(metamask)
    expect(options[1]?.provider).toBe(phantom)
  })

  it('falls back to legacy window.ethereum.providers choices', () => {
    const metamask = provider({ isMetaMask: true })
    const phantom = provider({ isPhantom: true })

    const options = getEvmWalletOptions({ ethereum: provider({ providers: [phantom, metamask] }) }, [])

    expect(options.map((option) => option.name)).toEqual(['Phantom', 'MetaMask'])
    expect(options[0]?.provider).toBe(phantom)
    expect(options[1]?.provider).toBe(metamask)
  })

  it('falls back to a single legacy window.ethereum provider', () => {
    const metamask = provider({ isMetaMask: true })

    const options = getEvmWalletOptions({ ethereum: metamask }, [])

    expect(options).toHaveLength(1)
    expect(options[0]?.name).toBe('MetaMask')
    expect(options[0]?.provider).toBe(metamask)
  })

  it('dedupes repeated provider objects', () => {
    const metamask = provider({ isMetaMask: true })

    const options = getEvmWalletOptions({ ethereum: provider({ providers: [metamask, metamask] }) }, [])

    expect(options).toHaveLength(1)
    expect(options[0]?.provider).toBe(metamask)
  })

  it('uses the Farcaster Mini App provider when supplied', () => {
    const farcasterProvider = provider()
    const metamask = provider({ isMetaMask: true })

    const options = getEvmWalletOptions({ ethereum: metamask }, [], {
      id: 'farcaster-miniapp-wallet',
      name: 'Farcaster Wallet',
      provider: farcasterProvider,
    })

    expect(options).toHaveLength(1)
    expect(options[0]?.name).toBe('Farcaster Wallet')
    expect(options[0]?.provider).toBe(farcasterProvider)
  })

  it('falls back to existing accounts when requestAccounts is unsupported', async () => {
    const calls: string[] = []
    const evmProvider = provider({
      async request({ method }) {
        calls.push(method)
        if (method === 'eth_requestAccounts') {
          throw new Error('The provider does not support the requested method.')
        }
        if (method === 'eth_accounts') return ['0x000000000000000000000000000000000000b0b0']
        throw new Error('Unexpected method ' + method)
      },
    })

    await expect(connectWallet(evmProvider, { skipChainSetup: true })).resolves.toBe(
      '0x000000000000000000000000000000000000b0b0',
    )
    expect(calls).toEqual(['eth_requestAccounts', 'eth_accounts'])
  })

  it('can skip browser wallet chain setup for host-managed wallets', async () => {
    const calls: string[] = []
    const evmProvider = provider({
      async request({ method }) {
        calls.push(method)
        if (method === 'eth_requestAccounts') return ['0x000000000000000000000000000000000000b0b0']
        throw new Error('Unexpected method ' + method)
      },
    })

    await expect(connectWallet(evmProvider, { skipChainSetup: true })).resolves.toBe(
      '0x000000000000000000000000000000000000b0b0',
    )
    expect(calls).toEqual(['eth_requestAccounts'])
  })
})

function provider(flags: Partial<EthereumProvider> = {}): EthereumProvider {
  return {
    request: async () => [],
    ...flags,
  }
}
