import { TIMEFRAMES, type Timeframe } from '../lib/types'

interface Props {
  value: Timeframe
  onChange: (tf: Timeframe) => void
  compact?: boolean
}

export default function TimeframeSelector({ value, onChange, compact = false }: Props) {
  return (
    <div className={`tf-selector${compact ? ' compact' : ''}`} role="group" aria-label="Temporalidad">
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf}
          type="button"
          className={`tf-pill${tf === value ? ' active' : ''}`}
          aria-pressed={tf === value}
          onClick={() => onChange(tf)}
        >
          {tf}
        </button>
      ))}
    </div>
  )
}
