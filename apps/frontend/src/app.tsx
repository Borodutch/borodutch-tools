import { useEffect, useMemo, useState } from 'preact/hooks'
import { App as ClaimApp } from './claim-app'
import { App as LockApp } from './lock-app'

type Tool = 'claim' | 'lock'

const tools: Array<{ id: Tool; label: string; description: string }> = [
  {
    id: 'claim',
    label: '$bdtch claim',
    description: 'Claim Base Sepolia $testcoin from the Solana holder snapshot.',
  },
  {
    id: 'lock',
    label: '$testcoin lock',
    description: 'Lock Base Sepolia $testcoin for the one-year cliff.',
  },
]

export function App() {
  const [activeTool, setActiveTool] = useState<Tool>(initialTool)
  const activeDescription = useMemo(
    () => tools.find((tool) => tool.id === activeTool)?.description ?? '',
    [activeTool],
  )

  useEffect(() => {
    const handleHashChange = () => setActiveTool(initialTool())
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  function selectTool(nextTool: Tool) {
    setActiveTool(nextTool)
    window.history.replaceState(null, '', nextTool === 'claim' ? '#claim' : '#lock')
  }

  return (
    <main class="min-h-svh bg-[#f6f4ef] text-neutral-950">
      <header class="border-b border-neutral-300 bg-white">
        <div class="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-6 lg:px-8">
          <div>
            <p class="text-sm font-semibold text-emerald-700">tools.borodutch.com</p>
            <h1 class="mt-1 text-2xl font-semibold">Borodutch Tools</h1>
            <p class="mt-1 text-sm text-neutral-600">{activeDescription}</p>
          </div>
          <nav aria-label="Tools" class="inline-flex rounded-md border border-neutral-300 bg-neutral-100 p-1">
            {tools.map((tool) => (
              <button
                class={[
                  'h-10 rounded px-3 text-sm font-semibold transition',
                  activeTool === tool.id
                    ? 'bg-neutral-950 text-white'
                    : 'text-neutral-700 hover:bg-white hover:text-neutral-950',
                ].join(' ')}
                key={tool.id}
                onClick={() => selectTool(tool.id)}
                type="button"
              >
                {tool.label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      {activeTool === 'claim' ? <ClaimApp /> : <LockApp />}
    </main>
  )
}

function initialTool(): Tool {
  return window.location.hash === '#lock' ? 'lock' : 'claim'
}
