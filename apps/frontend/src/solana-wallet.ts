type SolanaPublicKey = {
  toBase58(): string
}

type SolanaSignMessageResult =
  | Uint8Array
  | {
      signature: Uint8Array
    }

export type FarcasterSolanaProvider = {
  request(args: { method: 'connect' }): Promise<{ publicKey: string }>
  signMessage(message: string): Promise<{ signature: string }>
}

type InjectedSolanaProvider = {
  isPhantom?: boolean
  publicKey?: SolanaPublicKey
  connect(): Promise<{ publicKey?: SolanaPublicKey }>
  signMessage(message: Uint8Array, encoding?: string): Promise<SolanaSignMessageResult>
  on?(event: string, handler: (...args: unknown[]) => void): void
  off?(event: string, handler: (...args: unknown[]) => void): void
  removeListener?(event: string, handler: (...args: unknown[]) => void): void
}

type StandardWalletAccount = {
  address?: string
  publicKey?: Uint8Array
  chains?: string[]
}

type StandardWallet = {
  name?: string
  accounts?: StandardWalletAccount[]
  features?: Record<string, unknown>
}

type StandardConnectFeature = {
  connect(input?: unknown): Promise<{ accounts?: StandardWalletAccount[] }>
}

type StandardEventsFeature = {
  on(event: string, listener: (...args: unknown[]) => void): () => void
}

type StandardSignMessageFeature = {
  signMessage(input: { account: StandardWalletAccount; message: Uint8Array }): Promise<{ signature: Uint8Array }>
}

type SolanaWindow = Window & {
  solana?: InjectedSolanaProvider
  phantom?: {
    solana?: InjectedSolanaProvider
  }
  solflare?: InjectedSolanaProvider
  backpack?: InjectedSolanaProvider | { solana?: InjectedSolanaProvider }
}

export type SolanaWallet = {
  label: string
  connect(): Promise<string>
  signMessage(message: string): Promise<Uint8Array>
  on?(event: 'accountChanged' | 'disconnect', handler: (value?: unknown) => void): () => void
}

export const NO_SOLANA_WALLET_MESSAGE =
  'No Solana wallet found. Install or enable Phantom, Solflare, or Backpack, then try again.'
export const FARCASTER_SOLANA_UNSUPPORTED_MESSAGE =
  'This Farcaster client does not expose a Solana wallet. Open tools.borodutch.com in a browser with Phantom, Solflare, or Backpack to claim $BORO.'

export function findSolanaWalletProvider(
  win: SolanaWindow = window,
  farcasterProvider?: FarcasterSolanaProvider | null,
): SolanaWallet | null {
  return (farcasterProvider ? farcasterSolanaWallet(farcasterProvider) : null) ?? findInjectedSolanaWallet(win) ?? null
}

export async function waitForSolanaWalletProvider(
  win: SolanaWindow = window,
  timeoutMs = 1500,
  farcasterProvider?: FarcasterSolanaProvider | null,
): Promise<SolanaWallet | null> {
  const immediate = findSolanaWalletProvider(win, farcasterProvider)
  if (immediate) return immediate

  return new Promise((resolve) => {
    let settled = false
    const standardCleanups: Array<() => void> = []

    const finish = (wallet: SolanaWallet | null) => {
      if (settled) return
      settled = true
      win.clearTimeout(timeout)
      win.clearInterval(interval)
      win.removeEventListener('phantom#initialized', check)
      win.removeEventListener('solana#initialized', check)
      for (const cleanup of standardCleanups) cleanup()
      resolve(wallet)
    }

    const check = () => {
      const wallet = findSolanaWalletProvider(win, farcasterProvider)
      if (wallet) finish(wallet)
    }

    const timeout = win.setTimeout(() => finish(null), timeoutMs)
    const interval = win.setInterval(check, 100)
    win.addEventListener('phantom#initialized', check)
    win.addEventListener('solana#initialized', check)
    standardCleanups.push(listenForStandardWallets(win, finish))
    check()
  })
}

export async function connectSolanaWallet(
  win: SolanaWindow = window,
  timeoutMs = 1500,
  options: { farcasterProvider?: FarcasterSolanaProvider | null; miniAppMode?: boolean } = {},
): Promise<{ wallet: SolanaWallet; publicKey: string }> {
  const wallet = await waitForSolanaWalletProvider(win, timeoutMs, options.farcasterProvider)

  if (!wallet) {
    throw new Error(options.miniAppMode ? FARCASTER_SOLANA_UNSUPPORTED_MESSAGE : NO_SOLANA_WALLET_MESSAGE)
  }

  return { wallet, publicKey: await wallet.connect() }
}

export function extractSignatureBytes(signed: SolanaSignMessageResult): Uint8Array {
  const signature = signed instanceof Uint8Array ? signed : signed.signature

  if (!(signature instanceof Uint8Array)) {
    throw new Error('Wallet did not return a message signature.')
  }

  return signature
}

function findInjectedSolanaWallet(win: SolanaWindow): SolanaWallet | null {
  const candidates = [
    win.phantom?.solana,
    win.solana,
    win.solflare,
    isBackpackWithSolana(win.backpack) ? win.backpack.solana : win.backpack,
  ].filter(isInjectedSolanaProvider)

  const provider = dedupeProviders(candidates)[0]
  return provider ? injectedSolanaWallet(provider) : null
}

function injectedSolanaWallet(provider: InjectedSolanaProvider): SolanaWallet {
  return {
    label: provider.isPhantom ? 'Phantom' : 'Solana wallet',
    async connect() {
      const connection = await provider.connect()
      const publicKey = connection.publicKey?.toBase58() ?? provider.publicKey?.toBase58()

      if (!publicKey) {
        throw new Error('Wallet did not return a Solana public key.')
      }

      return publicKey
    },
    async signMessage(message) {
      const signed = await provider.signMessage(new TextEncoder().encode(message), 'utf8')
      return extractSignatureBytes(signed)
    },
    on(event, handler) {
      if (!provider.on) return () => {}

      provider.on(event, handler)
      return () => {
        if (provider.off) provider.off(event, handler)
        else if (provider.removeListener) provider.removeListener(event, handler)
      }
    },
  }
}

function farcasterSolanaWallet(provider: FarcasterSolanaProvider): SolanaWallet {
  return {
    label: 'Farcaster Solana wallet',
    async connect() {
      const connection = await provider.request({ method: 'connect' })
      if (!connection.publicKey) {
        throw new Error('Wallet did not return a Solana public key.')
      }
      return connection.publicKey
    },
    async signMessage(message) {
      const signed = await provider.signMessage(message)
      return signatureStringBytes(signed.signature)
    },
  }
}

function listenForStandardWallets(win: SolanaWindow, registerWallet: (wallet: SolanaWallet) => void): () => void {
  const onRegister = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail
    const wallets = Array.isArray(detail) ? detail : [detail]

    for (const wallet of wallets) {
      const standardWallet = standardSolanaWallet(wallet)
      if (standardWallet) registerWallet(standardWallet)
    }
  }

  const register = (wallet: unknown) => {
    const standardWallet = standardSolanaWallet(wallet)
    if (standardWallet) registerWallet(standardWallet)
  }

  win.addEventListener('wallet-standard:register-wallet', onRegister)
  win.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: register }))
  return () => win.removeEventListener('wallet-standard:register-wallet', onRegister)
}

function standardSolanaWallet(wallet: unknown): SolanaWallet | null {
  if (!isStandardWallet(wallet)) return null

  const connectFeature = wallet.features?.['standard:connect'] as StandardConnectFeature | undefined
  const signFeature = wallet.features?.['solana:signMessage'] as StandardSignMessageFeature | undefined

  if (!connectFeature?.connect || !signFeature?.signMessage) return null

  let selectedAccount = findSolanaAccount(wallet.accounts)

  return {
    label: wallet.name ?? 'Solana wallet',
    async connect() {
      const connection = await connectFeature.connect()
      selectedAccount = findSolanaAccount(connection.accounts ?? wallet.accounts)

      if (!selectedAccount) {
        throw new Error('Wallet did not return a Solana public key.')
      }

      return accountAddress(selectedAccount)
    },
    async signMessage(message) {
      if (!selectedAccount) {
        await this.connect()
      }

      if (!selectedAccount) {
        throw new Error('Wallet did not return a Solana public key.')
      }

      const result = await signFeature.signMessage({
        account: selectedAccount,
        message: new TextEncoder().encode(message),
      })
      return extractSignatureBytes(result)
    },
    on(event, handler) {
      const eventsFeature = wallet.features?.['standard:events'] as StandardEventsFeature | undefined
      if (!eventsFeature?.on) return () => {}

      return eventsFeature.on(event === 'accountChanged' ? 'change' : event, handler)
    },
  }
}

function findSolanaAccount(accounts?: StandardWalletAccount[]): StandardWalletAccount | undefined {
  return accounts?.find((account) => account.chains?.some((chain) => chain.startsWith('solana:')) ?? true)
}

function accountAddress(account: StandardWalletAccount): string {
  if (account.address) return account.address
  if (account.publicKey) return base58Encode(account.publicKey)
  throw new Error('Wallet did not return a Solana public key.')
}

function isInjectedSolanaProvider(provider: unknown): provider is InjectedSolanaProvider {
  return Boolean(
    provider &&
      typeof provider === 'object' &&
      'connect' in provider &&
      typeof provider.connect === 'function' &&
      'signMessage' in provider &&
      typeof provider.signMessage === 'function',
  )
}

function isBackpackWithSolana(provider: SolanaWindow['backpack']): provider is { solana: InjectedSolanaProvider } {
  return Boolean(provider && typeof provider === 'object' && 'solana' in provider)
}

function isStandardWallet(wallet: unknown): wallet is StandardWallet {
  return Boolean(wallet && typeof wallet === 'object' && 'features' in wallet)
}

function dedupeProviders(providers: InjectedSolanaProvider[]): InjectedSolanaProvider[] {
  return [...new Set(providers)]
}

function base58Encode(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let zeros = 0
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1

  const digits = [0]
  for (const byte of bytes) {
    let carry = byte
    for (let index = 0; index < digits.length; index += 1) {
      const value = digits[index] * 256 + carry
      digits[index] = value % 58
      carry = Math.floor(value / 58)
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = Math.floor(carry / 58)
    }
  }

  return `${'1'.repeat(zeros)}${digits
    .reverse()
    .map((digit) => alphabet[digit])
    .join('')}`
}

function signatureStringBytes(signature: string): Uint8Array {
  const value = signature.trim()
  if (/^0x[0-9a-f]+$/i.test(value) && value.length % 2 === 0) {
    return Uint8Array.from(value.slice(2).match(/../g)?.map((byte) => Number.parseInt(byte, 16)) ?? [])
  }

  const candidates: Uint8Array[] = []
  if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)) {
    try {
      candidates.push(base58Decode(value))
    } catch {}
  }

  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    try {
      const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
      const binary = atob(padded)
      if (binary.length > 0) {
        candidates.push(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
      }
    } catch {
      // Fall through to base58; Farcaster hosts may choose either encoding.
    }
  }

  const signatureCandidate = candidates.find((candidate) => candidate.length === 64)
  if (signatureCandidate) return signatureCandidate

  const base64Candidate = candidates[1]
  if (base64Candidate) return base64Candidate

  const base58Candidate = candidates[0]
  if (base58Candidate) return base58Candidate

  throw new Error('Wallet did not return a valid message signature.')
}

function base58Decode(value: string): Uint8Array {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  const indexes = new Map([...alphabet].map((char, index) => [char, index]))
  let zeros = 0
  while (zeros < value.length && value[zeros] === '1') zeros += 1

  const bytes = [0]
  for (const char of value) {
    const index = indexes.get(char)
    if (index === undefined) throw new Error('Wallet did not return a valid message signature.')

    let carry = index
    for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 1) {
      const next = bytes[byteIndex] * 58 + carry
      bytes[byteIndex] = next & 0xff
      carry = next >> 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }

  return Uint8Array.from([...Array(zeros).fill(0), ...bytes.reverse()])
}
