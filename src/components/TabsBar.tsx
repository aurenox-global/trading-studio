import { baseAsset } from '../lib/format'
import type { PaneState } from '../lib/types'
import { BoltIcon, PlusIcon } from './Icons'

interface Props {
  panes: PaneState[]
  activeId: string
  onSelect: (id: string) => void
  onAdd: () => void
  onTrade: () => void
  openPositions: number
}

export default function TabsBar({ panes, activeId, onSelect, onAdd, onTrade, openPositions }: Props) {
  return (
    <nav className="tabs-bar" aria-label="Símbolos">
      <div className="tabs-scroll">
        {panes.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`tab${p.id === activeId ? ' active' : ''}`}
            onClick={() => onSelect(p.id)}
            aria-current={p.id === activeId}
          >
            <span className="tab-symbol">{baseAsset(p.symbol)}</span>
            <span className="tab-tf">{p.timeframe}</span>
          </button>
        ))}
        {panes.length < 4 && (
          <button type="button" className="tab add" onClick={onAdd} aria-label="Añadir gráfico">
            <PlusIcon size={16} />
          </button>
        )}
      </div>
      <button type="button" className="trade-fab" onClick={onTrade} aria-label="Operar">
        <BoltIcon size={18} />
        {openPositions > 0 && <span className="fab-badge">{openPositions}</span>}
      </button>
    </nav>
  )
}
