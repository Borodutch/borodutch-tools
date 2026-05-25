import { MemoryClaimStore } from './memoryStore.ts'
import { PostgresClaimStore } from './postgresStore.ts'
import type { ClaimStore } from './types.ts'

type RuntimeEnv = Record<string, string | undefined>

export function getTestnetClaimsEnabled(env: RuntimeEnv) {
  const explicitValue = env.ENABLE_TESTNET_CLAIMS?.trim().toLowerCase()

  if (explicitValue) {
    return ['1', 'true', 'yes', 'on'].includes(explicitValue)
  }

  return env.NODE_ENV !== 'production'
}

export function getClaimRuntimeReady(env: RuntimeEnv, missingRuntimeEnv: string[]) {
  assertInMemoryClaimStoreAllowed(env)

  return missingRuntimeEnv.length === 0 || canUseInMemoryClaimStore(env, missingRuntimeEnv)
}

export async function createClaimStore(env: RuntimeEnv): Promise<ClaimStore> {
  assertInMemoryClaimStoreAllowed(env)

  if (env.DATABASE_URL) {
    return new PostgresClaimStore(env.DATABASE_URL)
  }

  if (canUseInMemoryClaimStore(env, ['DATABASE_URL'])) {
    return new MemoryClaimStore()
  }

  if (env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required for production claim persistence.')
  }

  throw new Error('DATABASE_URL is required unless ALLOW_IN_MEMORY_CLAIMS=true is set for local development or test.')
}

function assertInMemoryClaimStoreAllowed(env: RuntimeEnv) {
  if (env.NODE_ENV === 'production' && env.ALLOW_IN_MEMORY_CLAIMS === 'true') {
    throw new Error('ALLOW_IN_MEMORY_CLAIMS=true is not allowed in production.')
  }
}

function canUseInMemoryClaimStore(env: RuntimeEnv, missingRuntimeEnv: string[]) {
  return (
    env.ALLOW_IN_MEMORY_CLAIMS === 'true' &&
    isLocalDevelopmentOrTest(env) &&
    missingRuntimeEnv.length === 1 &&
    missingRuntimeEnv[0] === 'DATABASE_URL'
  )
}

function isLocalDevelopmentOrTest(env: RuntimeEnv) {
  return env.NODE_ENV === undefined || env.NODE_ENV === 'development' || env.NODE_ENV === 'test'
}
