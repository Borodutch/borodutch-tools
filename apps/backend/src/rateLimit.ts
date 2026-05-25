import { isIP } from 'node:net'

const directClientHeaders = ['cf-connecting-ip', 'true-client-ip', 'x-real-ip'] as const

type RateLimiterOptions = {
  maxKeys?: number
  now?: () => number
}

type ClientIdentityOptions = {
  remoteAddress?: string
  trustProxyHeaders?: boolean
}

export class RateLimiter {
  private readonly hits = new Map<string, number[]>()
  private readonly maxKeys: number
  private readonly now: () => number

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    options: RateLimiterOptions = {},
  ) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('rate limit must be a positive integer')
    }

    if (!Number.isInteger(windowMs) || windowMs < 1) {
      throw new Error('rate limit window must be a positive integer')
    }

    this.maxKeys = options.maxKeys ?? 10_000
    this.now = options.now ?? Date.now

    if (!Number.isInteger(this.maxKeys) || this.maxKeys < 1) {
      throw new Error('rate limit max keys must be a positive integer')
    }
  }

  take(key: string) {
    const now = this.now()
    this.evictExpired(now)

    const timestamps = this.hits.get(key) ?? []

    if (timestamps.length >= this.limit) {
      return false
    }

    if (timestamps.length === 0) {
      this.evictOverflow()
    }

    timestamps.push(now)
    this.hits.set(key, timestamps)
    return true
  }

  activeKeyCount() {
    return this.hits.size
  }

  private evictExpired(now: number) {
    for (const [key, timestamps] of this.hits) {
      const fresh = timestamps.filter((timestamp) => now - timestamp < this.windowMs)

      if (fresh.length === 0) {
        this.hits.delete(key)
      } else if (fresh.length !== timestamps.length) {
        this.hits.set(key, fresh)
      }
    }
  }

  private evictOverflow() {
    while (this.hits.size >= this.maxKeys) {
      const oldestKey = this.hits.keys().next().value as string | undefined

      if (!oldestKey) {
        return
      }

      this.hits.delete(oldestKey)
    }
  }
}

export function claimRateLimitKey(request: Request, pathname: string, options: ClientIdentityOptions = {}) {
  return `${clientIdentity(request.headers, options)}|${pathname}`
}

export function clientIdentity(headers: Headers, options: ClientIdentityOptions = {}) {
  const remoteIdentity = normalizeIp(options.remoteAddress ?? null)

  if (!options.trustProxyHeaders) {
    return remoteIdentity ?? 'local'
  }

  for (const header of directClientHeaders) {
    const identity = normalizeIp(headers.get(header))

    if (identity) {
      return identity
    }
  }

  const forwardedIdentity = forwardedFor(headers.get('forwarded'))

  if (forwardedIdentity) {
    return forwardedIdentity
  }

  const xForwardedIdentity = xForwardedFor(headers.get('x-forwarded-for'))

  if (xForwardedIdentity) {
    return xForwardedIdentity
  }

  return remoteIdentity ?? 'local'
}

function forwardedFor(header: string | null) {
  if (!header) {
    return undefined
  }

  for (const part of header.split(',')) {
    const forParam = part
      .split(';')
      .map((segment) => segment.trim())
      .find((segment) => segment.toLowerCase().startsWith('for='))

    if (!forParam) {
      continue
    }

    const identity = normalizeIp(forParam.slice('for='.length))

    if (identity) {
      return identity
    }
  }

  return undefined
}

function xForwardedFor(header: string | null) {
  if (!header) {
    return undefined
  }

  for (const part of header.split(',')) {
    const identity = normalizeIp(part)

    if (identity) {
      return identity
    }
  }

  return undefined
}

function normalizeIp(value: string | null) {
  if (!value) {
    return undefined
  }

  let candidate = value.trim()

  if (candidate.startsWith('"') && candidate.endsWith('"')) {
    candidate = candidate.slice(1, -1).trim()
  }

  if (candidate.startsWith('[')) {
    const closingBracket = candidate.indexOf(']')

    if (closingBracket === -1) {
      return undefined
    }

    candidate = candidate.slice(1, closingBracket)
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(candidate)) {
    candidate = candidate.slice(0, candidate.lastIndexOf(':'))
  }

  if (!isIP(candidate)) {
    return undefined
  }

  return candidate.toLowerCase()
}
