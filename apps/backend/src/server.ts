import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BaseSepoliaTokenSender, getMissingRuntimeEnv } from './claim/chainSender.ts'
import { MemoryClaimStore } from './claim/memoryStore.ts'
import { PostgresClaimStore } from './claim/postgresStore.ts'
import { ClaimError, createClaimService } from './claim/service.ts'
import type { ClaimStore, TokenSender } from './claim/types.ts'

class RateLimiter {
  private readonly hits = new Map<string, number[]>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  take(key: string) {
    const now = Date.now()
    const timestamps = (this.hits.get(key) ?? []).filter((timestamp) => now - timestamp < this.windowMs)

    if (timestamps.length >= this.limit) {
      this.hits.set(key, timestamps)
      return false
    }

    timestamps.push(now)
    this.hits.set(key, timestamps)
    return true
  }
}

const port = Number(Bun.env.PORT ?? 3000)
const missingRuntimeEnv = getMissingRuntimeEnv(Bun.env)
const allowInMemoryClaims = Bun.env.ALLOW_IN_MEMORY_CLAIMS === 'true'
const runtimeReady = missingRuntimeEnv.length === 0 || (allowInMemoryClaims && missingRuntimeEnv.length === 1 && missingRuntimeEnv[0] === 'DATABASE_URL')
const store = await createStore()
const sender = createSender()
const service = createClaimService({
  store,
  sender,
  env: {
    ...Bun.env,
    TESTCOIN_CLAIM_POOL_RAW: Bun.env.TESTCOIN_CLAIM_POOL_RAW ?? '1',
  },
})
const limiter = new RateLimiter(60, 60_000)

await store.initialize()

Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() })
    }

    try {
      if (url.pathname === '/health') {
        return json({ ok: true })
      }

      if (url.pathname.startsWith('/api/claim')) {
        const limited = limiter.take(clientKey(request, url.pathname))

        if (!limited) {
          return json({ error: 'rate_limited', message: 'Too many requests. Please wait and retry.' }, 429)
        }

        return handleClaimApi(request, url)
      }

      return serveStatic(url)
    } catch (error) {
      if (error instanceof ClaimError) {
        return json({ error: error.code, message: error.message, details: error.details }, statusForClaimError(error.code))
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
    return json(service.getConfig(runtimeReady ? [] : missingRuntimeEnv))
  }

  if (request.method === 'GET' && url.pathname === '/api/claim/allocation') {
    const solanaAddress = url.searchParams.get('solanaAddress')

    if (!runtimeReady) {
      return json({ error: 'runtime_not_configured', missingRuntimeEnv }, 503)
    }

    return json(await service.getAllocation(solanaAddress))
  }

  if (request.method === 'POST' && url.pathname === '/api/claim/challenges') {
    ensureRuntimeReady()
    const body = (await request.json()) as { solanaAddress: unknown; evmRecipient: unknown }
    return json(await service.createChallenge(body), 201)
  }

  if (request.method === 'POST' && url.pathname === '/api/claim/submit') {
    ensureRuntimeReady()
    const body = (await request.json()) as {
      challengeId: unknown
      solanaAddress: unknown
      evmRecipient: unknown
      signatureBase58: unknown
    }
    return json(await service.submitClaim(body), 202)
  }

  return json({ error: 'not_found', message: 'API route not found.' }, 404)
}

async function createStore(): Promise<ClaimStore> {
  if (Bun.env.DATABASE_URL) {
    return new PostgresClaimStore(Bun.env.DATABASE_URL)
  }

  if (allowInMemoryClaims || Bun.env.NODE_ENV !== 'production') {
    return new MemoryClaimStore()
  }

  return new MemoryClaimStore()
}

function createSender(): TokenSender {
  try {
    return new BaseSepoliaTokenSender(Bun.env)
  } catch {
    return {
      async sendTestcoin() {
        throw new Error('Base Sepolia sender is not configured')
      },
    }
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

function serveStatic(url: URL) {
  const distDir = fileURLToPath(new URL('../../frontend/dist', import.meta.url))
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname
  const filePath = join(distDir, pathname)
  const file = Bun.file(filePath)

  if (file.size > 0) {
    return new Response(file)
  }

  return new Response(Bun.file(join(distDir, 'index.html')))
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
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  }
}

function clientKey(request: Request, pathname: string) {
  return `${request.headers.get('x-forwarded-for') ?? 'local'}:${pathname}`
}

function statusForClaimError(code: string) {
  if (code === 'runtime_not_configured') return 503
  if (code === 'not_eligible' || code === 'zero_allocation') return 403
  if (code === 'already_claimed' || code === 'recipient_already_used') return 409
  if (code === 'chain_send_failed') return 502
  return 400
}
