import { describe, expect, it } from 'vitest'
import { RateLimiter, claimRateLimitKey, clientIdentity } from '../src/rateLimit.ts'

describe('claim API rate limiting', () => {
  it('uses the remote socket address by default instead of spoofable forwarded headers', () => {
    const headers = new Headers({ 'x-forwarded-for': '198.51.100.7' })

    expect(clientIdentity(headers, { remoteAddress: '203.0.113.10' })).toBe('203.0.113.10')
  })

  it('normalizes forwarded client identity when proxy headers are explicitly trusted', () => {
    const options = { trustProxyHeaders: true, remoteAddress: '10.0.0.10' }

    expect(clientIdentity(new Headers({ 'cf-connecting-ip': ' 203.0.113.10 ' }), options)).toBe('203.0.113.10')
    expect(clientIdentity(new Headers({ forwarded: 'for="[2001:DB8::1]:443";proto=https' }), options)).toBe(
      '2001:db8::1',
    )
    expect(clientIdentity(new Headers({ 'x-forwarded-for': 'bad-input, 198.51.100.7' }), options)).toBe(
      '198.51.100.7',
    )
    expect(clientIdentity(new Headers({ 'x-forwarded-for': 'bad-input' }), options)).toBe('10.0.0.10')
  })

  it('uses normalized client identity and route for the claim API key', () => {
    const request = new Request('http://localhost/api/claim/config', {
      headers: {
        'x-forwarded-for': '198.51.100.7:51234, 10.0.0.10',
      },
    })

    expect(
      claimRateLimitKey(request, '/api/claim/config', {
        remoteAddress: '10.0.0.10',
        trustProxyHeaders: true,
      }),
    ).toBe('198.51.100.7|/api/claim/config')
  })

  it('does not allow spoofed forwarded headers to bypass a claim route limit by default', () => {
    const limiter = new RateLimiter(1, 60_000)
    const firstRequest = new Request('http://localhost/api/claim/config', {
      headers: { 'x-forwarded-for': '198.51.100.7' },
    })
    const secondRequest = new Request('http://localhost/api/claim/config', {
      headers: { 'x-forwarded-for': ' 198.51.100.7:51234, 10.0.0.10' },
    })
    const options = { remoteAddress: '203.0.113.10' }

    expect(limiter.take(claimRateLimitKey(firstRequest, '/api/claim/config', options))).toBe(true)
    expect(limiter.take(claimRateLimitKey(secondRequest, '/api/claim/config', options))).toBe(false)
  })

  it('evicts stale identities after the rate-limit window', () => {
    let now = 0
    const limiter = new RateLimiter(2, 1_000, { now: () => now })

    expect(limiter.take('client-a|/api/claim/config')).toBe(true)
    expect(limiter.take('client-b|/api/claim/config')).toBe(true)
    expect(limiter.activeKeyCount()).toBe(2)

    now = 1_001
    expect(limiter.take('client-c|/api/claim/config')).toBe(true)

    expect(limiter.activeKeyCount()).toBe(1)
  })

  it('caps active identities when clients churn within the same window', () => {
    const limiter = new RateLimiter(2, 60_000, { maxKeys: 2 })

    expect(limiter.take('client-a|/api/claim/config')).toBe(true)
    expect(limiter.take('client-b|/api/claim/config')).toBe(true)
    expect(limiter.take('client-c|/api/claim/config')).toBe(true)

    expect(limiter.activeKeyCount()).toBe(2)
  })
})
