import { timingSafeEqual } from 'node:crypto'
import { extname } from 'node:path'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClaimTokenSender, getClaimRuntimeConfig, getMissingRuntimeEnv } from './claim/chainSender.ts'
import { createClaimStore, getClaimRuntimeReady } from './claim/runtime.ts'
import { ClaimError, createClaimService } from './claim/service.ts'
import { snapshotMetadata } from './claim/snapshot.ts'
import type { TokenSender } from './claim/types.ts'
import { RateLimiter, claimRateLimitKey } from './rateLimit.ts'

const port = Number(Bun.env.PORT ?? 3000)
const claimConfig = getClaimRuntimeConfig(Bun.env)
const missingRuntimeEnv = getMissingRuntimeEnv(Bun.env)
const trustProxyHeaders = Bun.env.TRUST_PROXY_HEADERS === 'true'
const runtimeReady = getClaimRuntimeReady(Bun.env, missingRuntimeEnv)
const store = runtimeReady ? await createClaimStore(Bun.env) : null
const sender = runtimeReady ? createSender() : null
const service =
  store && sender
    ? createClaimService({
        store,
        sender,
        env: Bun.env,
        claimConfig,
      })
    : null
const limiter = new RateLimiter(60, 60_000)

await store?.initialize()

Bun.serve({
  port,
  async fetch(request, server) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() })
    }

    try {
      if (url.pathname === '/health') {
        return json({ ok: true })
      }

      if (url.pathname.startsWith('/api/claim')) {
        const limited = limiter.take(
          claimRateLimitKey(request, url.pathname, {
            remoteAddress: server.requestIP(request)?.address,
            trustProxyHeaders,
          }),
        )

        if (!limited) {
          return json({ error: 'rate_limited', message: 'Too many requests. Please wait and retry.' }, 429)
        }

        return await handleClaimApi(request, url)
      }

      return serveStatic(url)
    } catch (error) {
      if (error instanceof ClaimError) {
        const status = statusForClaimError(error.code)
        console.warn(
          JSON.stringify({
            event: 'claim_api_error',
            path: url.pathname,
            code: error.code,
            status,
            message: error.message,
          }),
        )
        return json({ error: error.code, message: error.message, details: error.details }, status)
      }

      if (error instanceof Error) {
        return json({ error: 'server_error', message: error.message }, 500)
      }

      return json({ error: 'server_error', message: 'Unexpected server error.' }, 500)
    }
  },
})

console.log(`Borodutch Tools backend listening on :${port}`)

async function handleClaimApi(request: Request, url: URL) {
  if (request.method === 'GET' && url.pathname === '/api/claim/config') {
    return json(service ? service.getConfig([]) : getDisabledClaimConfig())
  }

  if (!runtimeReady) {
    return json(
      {
        error: 'claim_api_disabled',
        message: `${claimConfig.purpose} API is disabled in this deployment.`,
        missingRuntimeEnv,
      },
      410,
    )
  }

  if (request.method === 'GET' && url.pathname === '/api/claim/allocation') {
    const solanaAddress = url.searchParams.get('solanaAddress')

    if (!runtimeReady) {
      return json({ error: 'runtime_not_configured', missingRuntimeEnv }, 503)
    }

    return json(await getClaimService().getAllocation(solanaAddress))
  }

  if (request.method === 'POST' && url.pathname === '/api/claim/allocation-message') {
    const body = (await request.json()) as { solanaAddress: unknown }
    return json(getClaimService().getAllocationCheckMessage(body.solanaAddress), 201)
  }

  if (request.method === 'POST' && url.pathname === '/api/claim/allocation-check') {
    ensureRuntimeReady()
    const body = (await request.json()) as { solanaAddress: unknown; signatureBase58: unknown; diagnostics?: unknown }
    return json(await getClaimService().checkAllocation(body))
  }

  if (request.method === 'POST' && url.pathname === '/api/claim/challenges') {
    ensureRuntimeReady()
    const body = (await request.json()) as { solanaAddress: unknown; evmRecipient: unknown }
    return json(await getClaimService().createChallenge(body), 201)
  }

  if (request.method === 'POST' && url.pathname === '/api/claim/submit') {
    ensureRuntimeReady()
    const body = (await request.json()) as {
      challengeId: unknown
      solanaAddress: unknown
      evmRecipient: unknown
      signatureBase58: unknown
      diagnostics?: unknown
    }
    return json(await getClaimService().submitClaim(body), 202)
  }

  if (request.method === 'POST' && url.pathname === '/api/claim/admin/retry') {
    ensureRuntimeReady()
    ensureClaimAdminAuthorized(request)
    const body = (await request.json()) as { claimId: unknown; allowMissingTxRetry?: unknown }
    return json(
      await getClaimService().retryFailedClaim({
        claimId: body.claimId,
        allowMissingTxRetry: body.allowMissingTxRetry === true,
      }),
      202,
    )
  }

  return json({ error: 'not_found', message: 'API route not found.' }, 404)
}

function createSender(): TokenSender {
  try {
    return createClaimTokenSender(Bun.env)
  } catch {
    return {
      async sendToken() {
        throw new Error(`${claimConfig.networkName} sender is not configured`)
      },
      async getTransferRecoveryState() {
        throw new Error(`${claimConfig.networkName} sender is not configured`)
      },
    }
  }
}

function getDisabledClaimConfig() {
  return {
    app: 'Borodutch Tools',
    purpose: claimConfig.purpose,
    enabled: false,
    disabledReason: `${claimConfig.networkName} ${claimConfig.tokenSymbol} claims are disabled until runtime environment is complete.`,
    network: claimConfig.networkName,
    tokenSymbol: claimConfig.tokenSymbol,
    chainId: claimConfig.chainId,
    snapshot: snapshotMetadata,
    missingRuntimeEnv,
  }
}

function ensureRuntimeReady() {
  if (!runtimeReady) {
    throw new ClaimError(
      'runtime_not_configured',
      'Claim service is missing required runtime environment.',
      missingRuntimeEnv,
    )
  }
}

function getClaimService() {
  if (!service) {
    throw new ClaimError('runtime_not_configured', 'Claim service is not configured.')
  }

  return service
}

function ensureClaimAdminAuthorized(request: Request) {
  const expectedToken = Bun.env.CLAIM_ADMIN_TOKEN

  if (!expectedToken) {
    throw new ClaimError('admin_not_configured', 'Claim admin retry is not configured.')
  }

  const authHeader = request.headers.get('authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined
  const token = bearerToken ?? request.headers.get('x-admin-token')

  if (!token || !tokensMatch(token, expectedToken)) {
    throw new ClaimError('admin_unauthorized', 'Claim admin token is invalid.')
  }
}

function serveStatic(url: URL) {
  const distDir = fileURLToPath(new URL('../../frontend/dist', import.meta.url))
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname
  const filePath = join(distDir, pathname)
  const file = Bun.file(filePath)

  if (file.size > 0) {
    return new Response(file, { headers: staticHeaders(pathname) })
  }

  if (url.pathname === '/.well-known/farcaster.json') {
    return json({ error: 'not_found', message: 'Farcaster manifest not found.' }, 404)
  }

  return new Response(Bun.file(join(distDir, 'index.html')), { headers: staticHeaders('/index.html') })
}

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: corsHeaders(),
  })
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': Bun.env.CORS_ORIGIN ?? '*',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-admin-token',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  }
}

function staticHeaders(pathname: string) {
  const contentType = contentTypeFor(pathname)

  return {
    ...(contentType ? { 'Content-Type': contentType } : {}),
    'Cache-Control': cacheControlFor(pathname),
  }
}

function contentTypeFor(pathname: string) {
  if (pathname === '/.well-known/farcaster.json' || pathname.endsWith('.webmanifest')) return 'application/json; charset=utf-8'

  switch (extname(pathname)) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.png':
      return 'image/png'
    case '.svg':
      return 'image/svg+xml'
    case '.ico':
      return 'image/x-icon'
    default:
      return undefined
  }
}

function cacheControlFor(pathname: string) {
  if (pathname === '/.well-known/farcaster.json') return 'public, max-age=60, must-revalidate'
  if (pathname.startsWith('/farcaster/') || pathname.endsWith('.png') || pathname.endsWith('.svg')) {
    return 'public, max-age=86400, must-revalidate'
  }

  return 'public, max-age=0, must-revalidate'
}

function statusForClaimError(code: string) {
  if (code === 'runtime_not_configured') return 503
  if (code === 'admin_not_configured') return 503
  if (code === 'admin_unauthorized') return 401
  if (code === 'claim_not_found') return 404
  if (code === 'claim_retry_not_failed') return 409
  if (code === 'not_eligible' || code === 'zero_allocation') return 403
  if (code === 'already_claimed' || code === 'recipient_already_used') return 409
  if (code === 'chain_send_failed') return 502
  return 400
}

function tokensMatch(actual: string, expected: string) {
  const actualBytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)

  if (actualBytes.length !== expectedBytes.length) {
    return false
  }

  return timingSafeEqual(actualBytes, expectedBytes)
}
