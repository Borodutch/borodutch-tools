import { Pool, type PoolClient } from 'pg'
import { holders, holdersByOwner, snapshotMetadata } from './snapshot.ts'
import type {
  ClaimChallenge,
  ClaimRecord,
  ClaimStore,
  ExistingClaimResult,
  HolderAllocation,
  SnapshotMetadata,
} from './types.ts'

type ClaimRow = {
  id: string
  challenge_id: string
  nonce: string
  solana_address: string
  evm_recipient: string
  holder_bdtch_raw: string
  claim_amount_raw: string
  message_digest: string
  signature_base58: string
  tx_hash: string | null
  status: ClaimRecord['status']
  error_code: string | null
  created_at: Date
  updated_at: Date
}

type ChallengeRow = {
  id: string
  nonce: string
  solana_address: string
  evm_recipient: string
  holder_bdtch_raw: string
  claim_amount_raw: string
  message: string
  message_digest: string
  expires_at: Date
  used_at: Date | null
}

export class PostgresClaimStore implements ClaimStore {
  private readonly pool: Pool

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
    })
  }

  async initialize() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS claim_snapshots (
        id TEXT PRIMARY KEY,
        mint TEXT NOT NULL,
        decimals INTEGER NOT NULL,
        supply_raw NUMERIC(80, 0) NOT NULL,
        helius_indexed_slot INTEGER NOT NULL,
        finalized_slot_start INTEGER NOT NULL,
        finalized_slot_end INTEGER NOT NULL,
        metadata JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS holder_allocations (
        snapshot_id TEXT NOT NULL REFERENCES claim_snapshots(id),
        solana_address TEXT NOT NULL,
        rank INTEGER NOT NULL,
        holder_bdtch_raw NUMERIC(80, 0) NOT NULL,
        holder_bdtch_display TEXT NOT NULL,
        token_account_count INTEGER NOT NULL,
        PRIMARY KEY (snapshot_id, solana_address)
      );

      CREATE TABLE IF NOT EXISTS claim_challenges (
        id TEXT PRIMARY KEY,
        nonce TEXT NOT NULL UNIQUE,
        solana_address TEXT NOT NULL,
        evm_recipient TEXT NOT NULL,
        holder_bdtch_raw NUMERIC(80, 0) NOT NULL,
        claim_amount_raw NUMERIC(80, 0) NOT NULL,
        message TEXT NOT NULL,
        message_digest TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS claims (
        id TEXT PRIMARY KEY,
        challenge_id TEXT NOT NULL UNIQUE REFERENCES claim_challenges(id),
        nonce TEXT NOT NULL UNIQUE,
        solana_address TEXT NOT NULL UNIQUE,
        evm_recipient TEXT NOT NULL UNIQUE,
        holder_bdtch_raw NUMERIC(80, 0) NOT NULL,
        claim_amount_raw NUMERIC(80, 0) NOT NULL,
        message_digest TEXT NOT NULL,
        signature_base58 TEXT NOT NULL,
        tx_hash TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'confirmed', 'failed')),
        error_code TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS claim_challenges_solana_address_idx ON claim_challenges(solana_address);
      CREATE INDEX IF NOT EXISTS claims_status_idx ON claims(status);
    `)

    await this.seedSnapshot()
  }

  getSnapshot(): SnapshotMetadata {
    return snapshotMetadata
  }

  getHolder(solanaAddress: string): HolderAllocation | undefined {
    return holdersByOwner.get(solanaAddress)
  }

  async getClaimById(id: string) {
    const result = await this.pool.query<ClaimRow>('SELECT * FROM claims WHERE id = $1 LIMIT 1', [id])

    return result.rows[0] ? claimFromRow(result.rows[0]) : undefined
  }

  async getClaimBySolana(solanaAddress: string) {
    const result = await this.pool.query<ClaimRow>('SELECT * FROM claims WHERE solana_address = $1 LIMIT 1', [
      solanaAddress,
    ])

    return result.rows[0] ? claimFromRow(result.rows[0]) : undefined
  }

  async getClaimByRecipient(evmRecipient: string) {
    const result = await this.pool.query<ClaimRow>('SELECT * FROM claims WHERE evm_recipient = $1 LIMIT 1', [
      evmRecipient,
    ])

    return result.rows[0] ? claimFromRow(result.rows[0]) : undefined
  }

  async createChallenge(input: Omit<ClaimChallenge, 'usedAt'>) {
    const result = await this.pool.query<ChallengeRow>(
      `INSERT INTO claim_challenges (
        id, nonce, solana_address, evm_recipient, holder_bdtch_raw, claim_amount_raw,
        message, message_digest, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        input.id,
        input.nonce,
        input.solanaAddress,
        input.evmRecipient,
        input.holderBdtchRaw,
        input.claimAmountRaw,
        input.message,
        input.messageDigest,
        input.expiresAt,
      ],
    )

    return challengeFromRow(result.rows[0])
  }

  async getChallenge(id: string) {
    const result = await this.pool.query<ChallengeRow>('SELECT * FROM claim_challenges WHERE id = $1 LIMIT 1', [id])
    return result.rows[0] ? challengeFromRow(result.rows[0]) : undefined
  }

  async markChallengeUsed(id: string) {
    await this.pool.query('UPDATE claim_challenges SET used_at = COALESCE(used_at, now()) WHERE id = $1', [id])
  }

  async createPendingClaim(input: Omit<ClaimRecord, 'createdAt' | 'updatedAt'>): Promise<ExistingClaimResult> {
    const client = await this.pool.connect()

    try {
      await client.query('BEGIN')

      const existing = await findExistingClaim(client, input.solanaAddress, input.evmRecipient, input.challengeId)

      if (existing) {
        await client.query('COMMIT')
        return { inserted: false, claim: existing }
      }

      const result = await client.query<ClaimRow>(
        `INSERT INTO claims (
          id, challenge_id, nonce, solana_address, evm_recipient, holder_bdtch_raw,
          claim_amount_raw, message_digest, signature_base58, tx_hash, status, error_code
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *`,
        [
          input.id,
          input.challengeId,
          input.nonce,
          input.solanaAddress,
          input.evmRecipient,
          input.holderBdtchRaw,
          input.claimAmountRaw,
          input.messageDigest,
          input.signatureBase58,
          input.txHash,
          input.status,
          input.errorCode,
        ],
      )

      await client.query('COMMIT')
      return { inserted: true, claim: claimFromRow(result.rows[0]) }
    } catch (error) {
      await client.query('ROLLBACK')

      if (isUniqueViolation(error)) {
        const existing = await findExistingClaim(client, input.solanaAddress, input.evmRecipient, input.challengeId)

        if (existing) {
          return { inserted: false, claim: existing }
        }
      }

      throw error
    } finally {
      client.release()
    }
  }

  async prepareClaimRetry(id: string) {
    const result = await this.pool.query<ClaimRow>(
      `UPDATE claims
       SET status = 'pending', tx_hash = NULL, error_code = NULL, updated_at = now()
       WHERE id = $1 AND status = 'failed'
       RETURNING *`,
      [id],
    )

    return result.rows[0] ? claimFromRow(result.rows[0]) : undefined
  }

  async updateClaimSent(id: string, txHash: string) {
    const result = await this.pool.query<ClaimRow>(
      `UPDATE claims
       SET status = 'sent', tx_hash = $2, error_code = NULL, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, txHash],
    )

    if (!result.rows[0]) {
      throw new Error('claim not found')
    }

    return claimFromRow(result.rows[0])
  }

  async updateClaimConfirmed(id: string, txHash: string | null) {
    const result = await this.pool.query<ClaimRow>(
      `UPDATE claims
       SET status = 'confirmed', tx_hash = $2, error_code = NULL, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, txHash],
    )

    if (!result.rows[0]) {
      throw new Error('claim not found')
    }

    return claimFromRow(result.rows[0])
  }

  async updateClaimFailed(id: string, errorCode: string, txHash?: string) {
    const result = await this.pool.query<ClaimRow>(
      `UPDATE claims
       SET status = 'failed', tx_hash = $3, error_code = $2, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, errorCode, txHash ?? null],
    )

    if (!result.rows[0]) {
      throw new Error('claim not found')
    }

    return claimFromRow(result.rows[0])
  }

  private async seedSnapshot() {
    await this.pool.query(
      `INSERT INTO claim_snapshots (
        id, mint, decimals, supply_raw, helius_indexed_slot, finalized_slot_start,
        finalized_slot_end, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO NOTHING`,
      [
        snapshotMetadata.id,
        snapshotMetadata.mint,
        snapshotMetadata.decimals,
        snapshotMetadata.supplyRaw,
        snapshotMetadata.heliusLastIndexedSlot,
        snapshotMetadata.finalizedSlotStart,
        snapshotMetadata.finalizedSlotEnd,
        JSON.stringify(snapshotMetadata),
      ],
    )

    for (const holder of holders) {
      await this.pool.query(
        `INSERT INTO holder_allocations (
          snapshot_id, solana_address, rank, holder_bdtch_raw, holder_bdtch_display, token_account_count
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (snapshot_id, solana_address) DO NOTHING`,
        [
          snapshotMetadata.id,
          holder.owner,
          holder.rank,
          holder.amountRaw,
          holder.amount,
          holder.tokenAccountCount,
        ],
      )
    }
  }
}

async function findExistingClaim(
  client: PoolClient,
  solanaAddress: string,
  evmRecipient: string,
  challengeId: string,
) {
  const result = await client.query<ClaimRow>(
    `SELECT * FROM claims
     WHERE solana_address = $1 OR evm_recipient = $2 OR challenge_id = $3
     LIMIT 1`,
    [solanaAddress, evmRecipient, challengeId],
  )

  return result.rows[0] ? claimFromRow(result.rows[0]) : undefined
}

function challengeFromRow(row: ChallengeRow): ClaimChallenge {
  return {
    id: row.id,
    nonce: row.nonce,
    solanaAddress: row.solana_address,
    evmRecipient: row.evm_recipient,
    holderBdtchRaw: row.holder_bdtch_raw,
    claimAmountRaw: row.claim_amount_raw,
    message: row.message,
    messageDigest: row.message_digest,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
  }
}

function claimFromRow(row: ClaimRow): ClaimRecord {
  return {
    id: row.id,
    challengeId: row.challenge_id,
    nonce: row.nonce,
    solanaAddress: row.solana_address,
    evmRecipient: row.evm_recipient,
    holderBdtchRaw: row.holder_bdtch_raw,
    claimAmountRaw: row.claim_amount_raw,
    messageDigest: row.message_digest,
    signatureBase58: row.signature_base58,
    txHash: row.tx_hash,
    status: row.status,
    errorCode: row.error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}
