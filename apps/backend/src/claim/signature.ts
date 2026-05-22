import { PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import nacl from 'tweetnacl'

export function verifySolanaSignature(input: {
  solanaAddress: string
  message: string
  signatureBase58: string
}) {
  try {
    const publicKey = new PublicKey(input.solanaAddress)
    const signature = bs58.decode(input.signatureBase58)
    const messageBytes = new TextEncoder().encode(input.message)

    return nacl.sign.detached.verify(messageBytes, signature, publicKey.toBytes())
  } catch {
    return false
  }
}
