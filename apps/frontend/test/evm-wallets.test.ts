import { describe, expect, it } from 'bun:test'
import { getEvmWalletOptions, type EthereumProvider } from '../src/evm'

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
})

function provider(flags: Partial<EthereumProvider> = {}): EthereumProvider {
  return {
    request: async () => [],
    ...flags,
  }
}
