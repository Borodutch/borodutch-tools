import snapshotJson from '../../data/bdtch-snapshot-2026-05-22.json' with { type: 'json' }
import { SNAPSHOT_ID, type HolderAllocation, type SnapshotMetadata } from './types.ts'

type SnapshotFile = {
  metadata: {
    token: string
    mint: string
    decimals: number
    supplyRaw: string
    supply: string
    snapshot: {
      heliusLastIndexedSlot: number
      finalizedSlotStart: number
      finalizedSlotEnd: number
      startedAt: string
      completedAt: string
    }
    counts: {
      uniqueHolders: number
    }
  }
  holders: Array<{
    rank: number
    owner: string
    amountRaw: string
    amount: string
    tokenAccountCount: number
  }>
}

const snapshot = snapshotJson as SnapshotFile

export const snapshotMetadata: SnapshotMetadata = {
  id: SNAPSHOT_ID,
  token: snapshot.metadata.token,
  mint: snapshot.metadata.mint,
  decimals: snapshot.metadata.decimals,
  supplyRaw: snapshot.metadata.supplyRaw,
  supply: snapshot.metadata.supply,
  heliusLastIndexedSlot: snapshot.metadata.snapshot.heliusLastIndexedSlot,
  finalizedSlotStart: snapshot.metadata.snapshot.finalizedSlotStart,
  finalizedSlotEnd: snapshot.metadata.snapshot.finalizedSlotEnd,
  startedAt: snapshot.metadata.snapshot.startedAt,
  completedAt: snapshot.metadata.snapshot.completedAt,
  uniqueHolders: snapshot.metadata.counts.uniqueHolders,
}

export const holders: HolderAllocation[] = snapshot.holders.map((holder) => ({
  rank: holder.rank,
  owner: holder.owner,
  amountRaw: holder.amountRaw,
  amount: holder.amount,
  tokenAccountCount: holder.tokenAccountCount,
}))

export const holdersByOwner = new Map(holders.map((holder) => [holder.owner, holder]))
