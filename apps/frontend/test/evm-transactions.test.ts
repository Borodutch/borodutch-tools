import { describe, expect, it } from 'bun:test'
import { waitForTransactionReceipt, type EthereumProvider } from '../src/evm'

describe('EVM transaction receipt polling', () => {
  it('waits until a transaction receipt is available', async () => {
    const requests: string[] = []
    const provider = receiptProvider([null, { status: '0x1', transactionHash: '0xabc' }], requests)

    const receipt = await waitForTransactionReceipt(provider, '0xabc', { pollMs: 0, timeoutMs: 1000 })

    expect(receipt).toEqual({ status: '0x1', transactionHash: '0xabc' })
    expect(requests).toEqual(['0xabc', '0xabc'])
  })

  it('rejects failed on-chain transactions', async () => {
    const provider = receiptProvider([{ status: '0x0', transactionHash: '0xabc' }])

    await expect(waitForTransactionReceipt(provider, '0xabc', { pollMs: 0, timeoutMs: 1000 })).rejects.toThrow(
      'Transaction failed on-chain.',
    )
  })
})

function receiptProvider(receipts: Array<object | null>, requests: string[] = []): EthereumProvider {
  return {
    async request({ method, params }) {
      if (method !== 'eth_getTransactionReceipt') throw new Error('Unexpected method ' + method)
      requests.push(String(Array.isArray(params) ? params[0] : ''))
      return receipts.shift() ?? null
    },
  }
}
