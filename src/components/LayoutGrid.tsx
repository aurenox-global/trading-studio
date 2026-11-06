import type { LayoutId, PaneState } from '../lib/types'
import ChartPane from './ChartPane'

interface Props {
  layout: LayoutId
  panes: PaneState[]
  activeId: string
  tv: boolean
  onChangePane: (id: string, patch: Partial<PaneState>) => void
  onOpenSymbols: (id: string) => void
  onActivate: (id: string) => void
  onToggleMax: (id: string) => void
  onClosePane: (id: string) => void
}

export default function LayoutGrid({
  layout,
  panes,
  activeId,
  tv,
  onChangePane,
  onOpenSymbols,
  onActivate,
  onToggleMax,
  onClosePane,
}: Props) {
  return (
    <div className={`layout-grid layout-${layout}`}>
      {panes.map((pane) => (
        <div
          key={pane.id}
          className={`pane-slot${pane.id === activeId ? ' mobile-active' : ''}${pane.maximized ? ' is-max' : ''}`}
          onPointerDown={() => onActivate(pane.id)}
        >
          <ChartPane
            pane={pane}
            tv={tv}
            onChange={(patch) => onChangePane(pane.id, patch)}
            onOpenSymbols={() => onOpenSymbols(pane.id)}
            onToggleMax={() => onToggleMax(pane.id)}
            onClose={() => onClosePane(pane.id)}
            canClose={panes.length > 1}
          />
        </div>
      ))}
    </div>
  )
}
