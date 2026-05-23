import { App as ClaimApp } from './claim-app'
import { App as LockApp } from './lock-app'

export function App() {
  return (
    <main class="min-h-svh bg-[#f7f7f4] text-neutral-950">
      <div class="mx-auto grid max-w-full grid-cols-1 gap-4 px-4 py-4 md:max-w-6xl md:grid-cols-2 md:px-6 lg:px-8">
        <ClaimApp />
        <LockApp />
      </div>
    </main>
  )
}
