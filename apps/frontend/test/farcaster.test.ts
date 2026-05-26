import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import {
  FARCASTER_FRAME_IMAGE_URL,
  FARCASTER_ICON_URL,
  FARCASTER_MINI_APP_URL,
  FARCASTER_SPLASH_URL,
  detectFarcasterMiniApp,
  farcasterMiniAppEmbed,
  hasMiniAppUrlHint,
  notifyFarcasterReady,
  serializeFarcasterMiniAppEmbed,
} from '../src/farcaster'

describe('Farcaster Mini App metadata', () => {
  it('serializes the root embed metadata for launch_frame', () => {
    const serialized = serializeFarcasterMiniAppEmbed()

    expect(JSON.parse(serialized)).toEqual(farcasterMiniAppEmbed)
    expect(farcasterMiniAppEmbed.version).toBe('1')
    expect(farcasterMiniAppEmbed.imageUrl).toBe(FARCASTER_FRAME_IMAGE_URL)
    expect(farcasterMiniAppEmbed.button.title).toBe('Claim $BORO')
    expect(farcasterMiniAppEmbed.button.action.type).toBe('launch_frame')
    expect(farcasterMiniAppEmbed.button.action.url).toBe(FARCASTER_MINI_APP_URL)
    expect(farcasterMiniAppEmbed.button.action.splashImageUrl).toBe(FARCASTER_SPLASH_URL)
  })

  it('keeps fc:miniapp, fc:frame, OG, and Twitter metadata on the root page', () => {
    const html = readFileSync(join(import.meta.dir, '../index.html'), 'utf8')
    const miniAppContent = metaContent(html, 'fc:miniapp')
    const frameContent = metaContent(html, 'fc:frame')

    expect(JSON.parse(miniAppContent)).toEqual(farcasterMiniAppEmbed)
    expect(JSON.parse(frameContent)).toEqual(farcasterMiniAppEmbed)
    expect(html).toContain('property="og:image" content="https://tools.borodutch.com/og-image.png"')
    expect(html).toContain('name="twitter:image" content="https://tools.borodutch.com/og-image.png"')
  })

  it('publishes Mini App manifest JSON under .well-known', () => {
    const manifest = JSON.parse(
      readFileSync(join(import.meta.dir, '../public/.well-known/farcaster.json'), 'utf8'),
    ) as {
      miniapp: Record<string, unknown>
      frame: Record<string, unknown>
    }

    expect(manifest.miniapp.version).toBe('1')
    expect(manifest.miniapp.name).toBe('Borodutch Tools')
    expect(manifest.miniapp.homeUrl).toBe(FARCASTER_MINI_APP_URL)
    expect(manifest.miniapp.iconUrl).toBe(FARCASTER_ICON_URL)
    expect(manifest.miniapp.splashImageUrl).toBe(FARCASTER_SPLASH_URL)
    expect(manifest.miniapp.imageUrl).toBe(FARCASTER_FRAME_IMAGE_URL)
    expect(manifest.miniapp.primaryCategory).toBe('finance')
    expect(manifest.miniapp.requiredChains).toEqual(['eip155:8453'])
    expect(manifest.miniapp.requiredCapabilities).toEqual([
      'actions.ready',
      'wallet.getEthereumProvider',
      'wallet.getSolanaProvider',
    ])
    expect(manifest.frame).toEqual(manifest.miniapp)
  })
})

describe('Farcaster Mini App lifecycle', () => {
  it('uses the Mini App URL hint before probing the SDK', async () => {
    const sdk = fakeSdk(false)

    await expect(detectFarcasterMiniApp(sdk, { pathname: '/', search: '?miniApp=true' })).resolves.toBe(true)
    expect(sdk.probes).toBe(0)
    expect(hasMiniAppUrlHint({ pathname: '/miniapp', search: '' })).toBe(true)
  })

  it('falls back to SDK runtime detection and calls ready', async () => {
    const sdk = fakeSdk(true)

    await expect(detectFarcasterMiniApp(sdk, { pathname: '/', search: '' })).resolves.toBe(true)
    await notifyFarcasterReady(sdk)

    expect(sdk.probes).toBe(1)
    expect(sdk.readyCalls).toBe(1)
  })
})

function metaContent(html: string, name: string): string {
  const match = html.match(new RegExp(`<meta\\s+name="${name}"\\s+content='([^']+)'`))
  if (!match?.[1]) throw new Error(`Missing ${name} meta tag`)
  return match[1]
}

function fakeSdk(isInMiniApp: boolean) {
  const sdk = {
    probes: 0,
    readyCalls: 0,
    actions: {
      ready: async () => {
        sdk.readyCalls += 1
      },
    },
    isInMiniApp: async () => {
      sdk.probes += 1
      return isInMiniApp
    },
    wallet: {
      getEthereumProvider: async () => null,
      getSolanaProvider: async () => null,
    },
  }
  return sdk
}
