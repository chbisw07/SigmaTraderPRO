import { cn } from '@/lib/utils'

type IndexTick = {
  name: string
  value: string
  change: string
  change_pct: string
}

const PLACEHOLDER: IndexTick[] = [
  { name: 'NIFTY', value: '24,050.60', change: '+275.50', change_pct: '+1.16%' },
  { name: 'SENSEX', value: '77,550.25', change: '+918.60', change_pct: '+1.20%' },
  { name: 'BANKNIFTY', value: '56,077.20', change: '+997.20', change_pct: '+1.81%' },
  { name: 'FINNIFTY', value: '25,210.40', change: '+120.10', change_pct: '+0.48%' },
  { name: 'MIDCAP', value: '12,430.15', change: '-35.25', change_pct: '-0.28%' },
]

function isPositive(change: string) {
  return change.trim().startsWith('+')
}

export function MarketIndices({ className }: { className?: string }) {
  return (
    <div className={cn('hidden xl:flex items-center gap-3', className)}>
      {PLACEHOLDER.slice(0, 5).map((i) => {
        const pos = isPositive(i.change)
        return (
          <div key={i.name} className="min-w-0">
            <div className="text-[11px] font-medium text-muted-foreground">
              {i.name}
            </div>
            <div className="flex items-baseline gap-2 text-xs">
              <span className="font-medium">{i.value}</span>
              <span
                className={cn(
                  'font-medium',
                  pos
                    ? 'text-emerald-700 dark:text-emerald-300'
                    : 'text-red-700 dark:text-red-300',
                )}
              >
                {i.change_pct}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

