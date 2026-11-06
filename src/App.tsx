import { useCallback, useEffect, useMemo, useState } from 'react'
import LayoutGrid from './components/LayoutGrid'
import OrderPanel from './components/OrderPanel'
import PositionsPanel from './components/PositionsPanel'
import SymbolPicker from './components/SymbolPicker'
import TabsBar from './components/TabsBar'
import {
  BoltIcon,
  CheckIcon,
  CloseIcon,
  LayoutColsIcon,
  LayoutGridIcon,
  LayoutRowsIcon,
  LayoutSingleIcon,
  LayoutTriIcon,
  LogoIcon,
  TvIcon,
  WalletIcon,
} from './components/Icons'
import { getDataSource, SOURCE_LABEL, subscribeDataSource, type DataSource } from './lib/binance'
import { fmtMoney, fmtPct } from './lib/format'
import { accountEquity, paper, usePaperAccount } from './lib/paperTrading'
import { prices } from './lib/ws'
import {
  DEFAULT_SYMBOLS,
  LAYOUTS,
  TIMEFRAMES,
  type LayoutId,
  type PaneState,
  type Timeframe,
} from './lib/types'

const UI_KEY = 'ts:ui:v2'
const LAYOUT_IDS = LAYOUTS.map((l) => l.id)

const PANE_COUNT: Record<LayoutId, number> = {
  '1x1': 1,
  '2x1': 2,
  '1x2': 2,
  '2x2': 4,
  '3': 3,
}

function layoutForCount(count: number, current: LayoutId): LayoutId {
  if (count <= 1) return '1x1'
  if (count === 2) return current === '2x1' || current === '1x2' ? current : '2x1'
  if (count === 3) return '3'
  return '2x2'
}

const LAYOUT_BUTTONS: { id: LayoutId; label: string; Icon: typeof LayoutSingleIcon }[] = [
  { id: '1x1', label: '1 panel', Icon: LayoutSingleIcon },
  { id: '2x1', label: '2 paneles en columnas', Icon: LayoutColsIcon },
  { id: '1x2', label: '2 paneles apilados', Icon: LayoutRowsIcon },
  { id: '3', label: '3 paneles', Icon: LayoutTriIcon },
  { id: '2x2', label: '4 paneles', Icon: LayoutGridIcon },
]

const DEFAULT_TF: Timeframe[] = ['15m', '1h', '4h', '1d']

interface PersistedUI {
  layout: LayoutId
  panes: PaneState[]
  activeId: string
  sideOpen: boolean
  tvPref: boolean | null
}

function makePane(index: number): PaneState {
  return {
    id: `p${index + 1}-${Math.random().toString(36).slice(2, 7)}`,
    symbol: DEFAULT_SYMBOLS[index] ?? 'BTCUSDT',
    timeframe: DEFAULT_TF[index] ?? '15m',
    ema: true,
    rsi: index === 0,
    volume: true,
  }
}

function defaultUI(): PersistedUI {
  const wide = typeof window !== 'undefined' && window.innerWidth >= 1100
  const layout: LayoutId = wide ? '2x2' : '1x1'
  const count = wide ? 4 : 2
  const panes = Array.from({ length: count }, (_, i) => makePane(i))
  return { layout, panes, activeId: panes[0].id, sideOpen: true, tvPref: null }
}

function validPane(value: unknown): value is PaneState {
  if (!value || typeof value !== 'object') return false
  const p = value as Partial<PaneState>
  return (
    typeof p.id === 'string' &&
    typeof p.symbol === 'string' &&
    TIMEFRAMES.includes(p.timeframe as Timeframe)
  )
}

function resizePanes(panes: PaneState[], count: number): PaneState[] {
  const next = panes.slice(0, count)
  for (let i = next.length; i < count; i++) next.push(makePane(i))
  return next
}

function loadUI(): PersistedUI {
  const fallback = defaultUI()
  try {
    const raw = localStorage.getItem(UI_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<PersistedUI>
    const layout = LAYOUT_IDS.includes(parsed.layout as LayoutId)
      ? (parsed.layout as LayoutId)
      : fallback.layout
    const storedPanes = Array.isArray(parsed.panes) ? parsed.panes.filter(validPane).slice(0, 4) : []
    const count = PANE_COUNT[layout]
    const panes = resizePanes(storedPanes.length > 0 ? storedPanes : fallback.panes, count)
    return {
      layout,
      panes,
      activeId: panes.some((p) => p.id === parsed.activeId) ? (parsed.activeId as string) : panes[0].id,
      sideOpen: typeof parsed.sideOpen === 'boolean' ? parsed.sideOpen : true,
      tvPref: typeof parsed.tvPref === 'boolean' ? parsed.tvPref : null,
    }
  } catch {
    return fallback
  }
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

function EquityChip() {
  const account = usePaperAccount()
  const [, setTick] = useState(0)
  useEffect(() => prices.subscribe(() => setTick((t) => t + 1)), [])
  const equity = accountEquity(account, prices.snapshot())
  const pnl = equity - account.startBalance
  const pnlPct = (pnl / account.startBalance) * 100
  return (
    <div className="equity-chip" title="Equity de la cuenta demo">
      <span className="equity-icon">
        <WalletIcon size={15} />
      </span>
      <span className="equity-body">
        <span className="equity-k">Equity demo</span>
        <span className="equity-v mono">
          {fmtMoney(equity)} <small>USDT</small>
        </span>
      </span>
      <span className={`equity-pnl mono ${pnl >= 0 ? 'up' : 'down'}`}>{fmtPct(pnlPct)}</span>
    </div>
  )
}

function SourceChip() {
  const [source, setSource] = useState<DataSource>(getDataSource())
  useEffect(() => subscribeDataSource(setSource), [])
  if (source === 'binance') return null
  return <span className="source-chip">Fuente: {SOURCE_LABEL[source]} (respaldo)</span>
}

export default function App() {
  const [boot] = useState(loadUI)
  const [layout, setLayout] = useState<LayoutId>(boot.layout)
  const [panes, setPanes] = useState<PaneState[]>(boot.panes)
  const [activeId, setActiveId] = useState<string>(boot.activeId)
  const [sideOpen, setSideOpen] = useState<boolean>(boot.sideOpen)
  const [tvPref, setTvPref] = useState<boolean | null>(boot.tvPref)
  const [pickerPaneId, setPickerPaneId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<'trade' | 'positions' | null>(null)

  const wideForTv = useMediaQuery('(min-width: 1900px)')
  const tv = tvPref ?? wideForTv

  useEffect(() => {
    const payload: PersistedUI = { layout, panes, activeId, sideOpen, tvPref }
    try {
      localStorage.setItem(UI_KEY, JSON.stringify(payload))
    } catch {
      /* ignore quota errors */
    }
  }, [layout, panes, activeId, sideOpen, tvPref])

  useEffect(() => {
    const unsub = prices.subscribe(() => {
      if (paper.getSnapshot().positions.length === 0) return
      paper.liquidate(prices.snapshot())
    })
    return () => {
      unsub()
    }
  }, [])

  useEffect(() => {
    if (!sheet) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSheet(null)
    }
    document.addEventListener('keydown', onKey)
    document.body.classList.add('no-scroll')
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.classList.remove('no-scroll')
    }
  }, [sheet])

  const activePane = useMemo(
    () => panes.find((p) => p.id === activeId) ?? panes[0],
    [panes, activeId],
  )

  const changePane = useCallback((id: string, patch: Partial<PaneState>) => {
    setPanes((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }, [])

  const applyLayout = useCallback((id: LayoutId) => {
    setLayout(id)
    setPanes((prev) =>
      resizePanes(
        prev.map((p) => ({ ...p, maximized: false })),
        PANE_COUNT[id],
      ),
    )
  }, [])

  const toggleMax = useCallback((id: string) => {
    setPanes((prev) => prev.map((p) => (p.id === id ? { ...p, maximized: !p.maximized } : { ...p, maximized: false })))
  }, [])

  const removePane = useCallback(
    (id: string) => {
      if (panes.length <= 1) return
      const next = panes.filter((p) => p.id !== id)
      setPanes(next)
      setLayout((current) => layoutForCount(next.length, current))
      if (activeId === id) setActiveId(next[0].id)
    },
    [panes, activeId],
  )

  const addPane = useCallback(() => {
    setPanes((prev) => {
      if (prev.length >= 4) return prev
      const pane = makePane(prev.length)
      setActiveId(pane.id)
      return [...prev, pane]
    })
  }, [])

  const account = usePaperAccount()
  const pickerPane = pickerPaneId ? panes.find((p) => p.id === pickerPaneId) : null

  return (
    <div className={`app${tv ? ' tv-mode' : ''}${sideOpen ? '' : ' side-closed'}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <LogoIcon size={19} />
          </span>
          <span className="brand-text">
            <span className="brand-name">Trading Studio</span>
            <span className="brand-sub">charts · demo</span>
          </span>
          <span className="badge-demo">DEMO</span>
        </div>

        <div className="topbar-center">
          <div className="layout-switcher" role="group" aria-label="Disposición de paneles">
            {LAYOUT_BUTTONS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                className={`layout-btn${layout === id ? ' active' : ''}`}
                aria-pressed={layout === id}
                aria-label={label}
                title={label}
                onClick={() => applyLayout(id)}
              >
                <Icon size={17} />
              </button>
            ))}
          </div>
          <SourceChip />
        </div>

        <div className="topbar-actions">
          <EquityChip />
          <button
            type="button"
            className={`icon-btn tv-btn${tv ? ' active' : ''}`}
            onClick={() => setTvPref(!tv)}
            aria-pressed={tv}
            aria-label="Modo TV"
            title="Modo TV: tipografía grande y alto contraste"
          >
            <TvIcon size={17} />
          </button>
          <button
            type="button"
            className="icon-btn side-toggle"
            onClick={() => setSideOpen((v) => !v)}
            aria-label={sideOpen ? 'Ocultar panel de trading' : 'Mostrar panel de trading'}
            title={sideOpen ? 'Ocultar panel' : 'Mostrar panel'}
          >
            <WalletIcon size={17} />
          </button>
        </div>
      </header>

      <main className="workspace">
        <div className="charts-area">
          <LayoutGrid
            layout={layout}
            panes={panes}
            activeId={activeId}
            tv={tv}
            onChangePane={changePane}
            onOpenSymbols={(id) => setPickerPaneId(id)}
            onActivate={setActiveId}
            onToggleMax={toggleMax}
            onClosePane={removePane}
          />
        </div>
        <aside className="side-panel" aria-label="Panel de trading">
          <div className="side-scroll">
            <OrderPanel symbol={activePane.symbol} onOpenSymbols={() => setPickerPaneId(activePane.id)} />
            <PositionsPanel />
          </div>
        </aside>
      </main>

      <TabsBar
        panes={panes}
        activeId={activeId}
        onSelect={setActiveId}
        onAdd={addPane}
        onClose={removePane}
        onTrade={() => setSheet('trade')}
        openPositions={account.positions.length}
      />

      {sheet && (
        <div className="overlay sheet-overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setSheet(null)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Panel de trading">
            <div className="sheet-grabber" aria-hidden="true" />
            <div className="sheet-head">
              <div className="sheet-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={sheet === 'trade'}
                  className={sheet === 'trade' ? 'active' : ''}
                  onClick={() => setSheet('trade')}
                >
                  <BoltIcon size={15} /> Operar
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={sheet === 'positions'}
                  className={sheet === 'positions' ? 'active' : ''}
                  onClick={() => setSheet('positions')}
                >
                  <CheckIcon size={15} /> Posiciones ({account.positions.length})
                </button>
              </div>
              <button type="button" className="icon-btn" onClick={() => setSheet(null)} aria-label="Cerrar">
                <CloseIcon />
              </button>
            </div>
            <div className="sheet-body">
              {sheet === 'trade' ? (
                <OrderPanel symbol={activePane.symbol} onOpenSymbols={() => setPickerPaneId(activePane.id)} />
              ) : (
                <PositionsPanel />
              )}
            </div>
          </div>
        </div>
      )}

      <SymbolPicker
        open={pickerPane !== null && pickerPane !== undefined}
        current={pickerPane?.symbol ?? activePane.symbol}
        onClose={() => setPickerPaneId(null)}
        onSelect={(symbol) => {
          if (pickerPaneId) changePane(pickerPaneId, { symbol })
        }}
      />
    </div>
  )
}
