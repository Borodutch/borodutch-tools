export function App() {
  const steps = [
    ['1', 'Burn $bdtch', 'Solana burn proof locks the conversion amount.'],
    ['2', 'Sign claim', 'Wallet signature binds the burn to a Base recipient.'],
    ['3', 'Receive $boro', 'Base distribution prepares the future staking layer.'],
  ]

  return (
    <main class="min-h-svh">
      <section class="mx-auto grid min-h-svh w-full max-w-6xl grid-cols-1 gap-10 px-5 py-8 md:grid-cols-[1fr_420px] md:items-center md:px-8 lg:px-10">
        <div class="space-y-8">
          <div class="inline-flex items-center gap-2 rounded-full border border-neutral-300 bg-white px-3 py-1 text-sm font-medium text-neutral-700">
            <span class="h-2 w-2 rounded-full bg-emerald-500"></span>
            tools.borodutch.com
          </div>

          <div class="max-w-3xl space-y-5">
            <h1 class="max-w-3xl text-5xl font-semibold leading-[0.96] text-neutral-950 sm:text-6xl md:text-7xl">
              Borodutch Tools
            </h1>
            <p class="max-w-2xl text-lg leading-8 text-neutral-700">
              A home for small, direct tools around Nikita's products and tokens.
              First up: a $bdtch burn on Solana, a signed claim, and $boro on Base.
            </p>
          </div>

          <div class="grid max-w-3xl gap-3 sm:grid-cols-3">
            {steps.map(([number, title, body]) => (
              <article
                class="rounded-lg border border-neutral-300 bg-white p-4 shadow-sm"
                key={number}
              >
                <div class="mb-4 flex h-9 w-9 items-center justify-center rounded-full bg-neutral-950 text-sm font-semibold text-white">
                  {number}
                </div>
                <h2 class="text-base font-semibold text-neutral-950">{title}</h2>
                <p class="mt-2 text-sm leading-6 text-neutral-600">{body}</p>
              </article>
            ))}
          </div>
        </div>

        <aside class="rounded-lg border border-neutral-950 bg-neutral-950 p-5 text-white shadow-2xl shadow-neutral-300">
          <div class="rounded-md border border-white/10 bg-white/5 p-4">
            <div class="mb-5 flex items-center justify-between text-sm text-neutral-300">
              <span>Conversion route</span>
              <span>Preview</span>
            </div>
            <div class="space-y-4">
              <div class="rounded-md bg-white p-4 text-neutral-950">
                <div class="text-xs font-semibold uppercase text-neutral-500">From</div>
                <div class="mt-2 flex items-center justify-between">
                  <span class="text-2xl font-semibold">$bdtch</span>
                  <span class="rounded-full bg-violet-100 px-3 py-1 text-sm font-medium text-violet-800">
                    Solana
                  </span>
                </div>
              </div>
              <div class="flex items-center justify-center">
                <div class="h-10 w-px bg-white/30"></div>
              </div>
              <div class="rounded-md bg-white p-4 text-neutral-950">
                <div class="text-xs font-semibold uppercase text-neutral-500">To</div>
                <div class="mt-2 flex items-center justify-between">
                  <span class="text-2xl font-semibold">$boro</span>
                  <span class="rounded-full bg-sky-100 px-3 py-1 text-sm font-medium text-sky-800">
                    Base
                  </span>
                </div>
              </div>
            </div>
            <button
              class="mt-5 w-full rounded-md bg-white px-4 py-3 text-sm font-semibold text-neutral-950 opacity-60"
              disabled
              type="button"
            >
              Converter coming soon
            </button>
          </div>
        </aside>
      </section>
    </main>
  )
}
