type SolanaPublicKey = {
  toBase58(): string
}

type SolanaSignMessageResult = Uint8Array | { signature: Uint8Array }

type SolanaProvider = {
  isPhantom?: boolean
  publicKey?: SolanaPublicKey
  connect(): Promise<{ publicKey?: SolanaPublicKey }>
  signMessage(message: Uint8Array, encoding?: string): Promise<SolanaSignMessageResult>
}

interface Window {
  solana?: SolanaProvider
  phantom?: {
    solana?: SolanaProvider
  }
  solflare?: SolanaProvider
  backpack?: SolanaProvider | { solana?: SolanaProvider }
}
