import { sdk as farcasterSdk } from '@farcaster/miniapp-sdk'

export const FARCASTER_DOMAIN = 'tools.borodutch.com'
export const FARCASTER_ORIGIN = `https://${FARCASTER_DOMAIN}`
export const FARCASTER_MINI_APP_URL = `${FARCASTER_ORIGIN}/?miniApp=true`
export const FARCASTER_ICON_URL = `${FARCASTER_ORIGIN}/farcaster/icon.png`
export const FARCASTER_SPLASH_URL = `${FARCASTER_ORIGIN}/farcaster/splash.png`
export const FARCASTER_FRAME_IMAGE_URL = `${FARCASTER_ORIGIN}/farcaster/frame.png`
export const FARCASTER_SPLASH_BACKGROUND = '#f7f7f4'

export type FarcasterEthereumProvider = {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>
  on?(event: string, handler: (...args: unknown[]) => void): void
  removeListener?(event: string, handler: (...args: unknown[]) => void): void
}

export type FarcasterSolanaProvider = {
  request(args: { method: 'connect' }): Promise<{ publicKey: string }>
  signMessage(message: string): Promise<{ signature: string }>
}

type MiniAppSdk = {
  isInMiniApp(timeoutMs?: number): Promise<boolean>
  actions: {
    ready(options?: Record<string, unknown>): Promise<void>
  }
  wallet: {
    getEthereumProvider(): Promise<unknown>
    getSolanaProvider(): Promise<unknown>
  }
}

export const farcasterMiniAppEmbed = {
  version: '1',
  imageUrl: FARCASTER_FRAME_IMAGE_URL,
  button: {
    title: 'Claim $BORO',
    action: {
      type: 'launch_frame',
      name: 'Borodutch Tools',
      url: FARCASTER_MINI_APP_URL,
      splashImageUrl: FARCASTER_SPLASH_URL,
      splashBackgroundColor: FARCASTER_SPLASH_BACKGROUND,
    },
  },
} as const

export function serializeFarcasterMiniAppEmbed(): string {
  return JSON.stringify(farcasterMiniAppEmbed)
}

export function hasMiniAppUrlHint(location: Pick<Location, 'pathname' | 'search'> = window.location): boolean {
  const params = new URLSearchParams(location.search)
  return location.pathname.startsWith('/miniapp') || params.get('miniApp') === 'true'
}

export async function detectFarcasterMiniApp(
  sdk: MiniAppSdk = farcasterSdk,
  location: Pick<Location, 'pathname' | 'search'> = window.location,
): Promise<boolean> {
  if (hasMiniAppUrlHint(location)) return true
  return probeFarcasterMiniApp(sdk)
}

export async function probeFarcasterMiniApp(sdk: MiniAppSdk = farcasterSdk): Promise<boolean> {
  return sdk.isInMiniApp(500).catch(() => false)
}

export async function notifyFarcasterReady(sdk: MiniAppSdk = farcasterSdk): Promise<void> {
  await withTimeout(sdk.actions.ready({}), 1200).catch(() => undefined)
}

export async function getFarcasterEthereumProvider(
  sdk: MiniAppSdk = farcasterSdk,
): Promise<FarcasterEthereumProvider | null> {
  const provider = await sdk.wallet.getEthereumProvider().catch(() => null)
  return isEthereumProvider(provider) ? provider : null
}

export async function getFarcasterSolanaProvider(
  sdk: MiniAppSdk = farcasterSdk,
): Promise<FarcasterSolanaProvider | null> {
  const provider = await sdk.wallet.getSolanaProvider().catch(() => null)
  return isFarcasterSolanaProvider(provider) ? provider : null
}

function isEthereumProvider(provider: unknown): provider is FarcasterEthereumProvider {
  return Boolean(provider && typeof provider === 'object' && 'request' in provider && typeof provider.request === 'function')
}

function isFarcasterSolanaProvider(provider: unknown): provider is FarcasterSolanaProvider {
  return Boolean(
    provider &&
      typeof provider === 'object' &&
      'request' in provider &&
      typeof provider.request === 'function' &&
      'signMessage' in provider &&
      typeof provider.signMessage === 'function',
  )
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => {
      globalThis.setTimeout(() => resolve(undefined), timeoutMs)
    }),
  ])
}
