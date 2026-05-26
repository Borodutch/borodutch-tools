import { PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import nacl from 'tweetnacl'

export type SolanaSignatureVerification = {
  valid: boolean
  reason: 'ok' | 'invalid_public_key' | 'invalid_signature_base58' | 'invalid_signature_length' | 'verify_false'
  messageByteLength: number
  publicKeyByteLength?: number
  signatureBase58Length: number
  signatureByteLength?: number
}

export function verifySolanaSignature(input: {
  solanaAddress: string
  message: string
  signatureBase58: string
}) {
  return verifySolanaSignatureDetailed(input).valid
}

export function verifySolanaSignatureDetailed(input: {
  solanaAddress: string
  message: string
  signatureBase58: string
}): SolanaSignatureVerification {
  const messageBytes = new TextEncoder().encode(input.message)
  const base = {
    messageByteLength: messageBytes.length,
    signatureBase58Length: input.signatureBase58.length,
  }

  let publicKey: PublicKey
  try {
    publicKey = new PublicKey(input.solanaAddress)
  } catch {
    return { ...base, valid: false, reason: 'invalid_public_key' }
  }

  const publicKeyBytes = publicKey.toBytes()
  let signature: Uint8Array
  try {
    signature = bs58.decode(input.signatureBase58)
  } catch {
    return { ...base, valid: false, reason: 'invalid_signature_base58', publicKeyByteLength: publicKeyBytes.length }
  }

  if (signature.length !== nacl.sign.signatureLength) {
    return {
      ...base,
      valid: false,
      reason: 'invalid_signature_length',
      publicKeyByteLength: publicKeyBytes.length,
      signatureByteLength: signature.length,
    }
  }

  const valid = nacl.sign.detached.verify(messageBytes, signature, publicKeyBytes)
  if (!valid) {
    return {
      ...base,
      valid: false,
      reason: 'verify_false',
      publicKeyByteLength: publicKeyBytes.length,
      signatureByteLength: signature.length,
    }
  }

  return {
    ...base,
    valid: true,
    reason: 'ok',
    publicKeyByteLength: publicKeyBytes.length,
    signatureByteLength: signature.length,
  }
}
