import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchSymbols, fetchTickers } from '../lib/binance'
import { baseAsset, fmtPct, fmtPrice } from '../lib/format'
import { POPULAR_SYMBOLS, type Ticker } from '../lib/types'
import { CloseIcon, SearchIcon } from './Icons'

interface Props {
  open: boolean
  current: string
  onClose: () => void
  onSelect: (symbol: string) => void
}

export default function SymbolPicker({ open, current, onClose, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [allSymbols, setAllSymbols] = useState<string[]>([])
  const [tickers, setTickers] = useState<Record<string, Ticker>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const requested = useRef(new Set<string>())

  useEffect(() => {
    if (!open) return
    setQuery('')
    setError(null)
    setLoading(true)
    let cancelled = false
    fetchSymbols()
      .then((list) => {
        if (!cancelled) setAllSymbols(list)
      })
      .catch(() => {
        if (!cancelled) setError('No se pudo cargar la lista de símbolos')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    const initial = POPULAR_SYMBOLS.slice(0, 24)
    fetchTickers([...initial, current])
      .then((rows) => {
        if (cancelled) return
        setTickers((prev) => {
          const next = { ...prev }
          for (const t of rows) next[t.symbol] = t
          return next
        })
      })
      .catch(() => {
        /* list still usable without tickers */
      })
    const t = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [open, current])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const results = useMemo(() => {
    const q = query.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    const source = allSymbols.length > 0 ? allSymbols : [...POPULAR_SYMBOLS]
    if (!q) return POPULAR_SYMBOLS.slice(0, 30)
    const direct = source.filter((s) => s.includes(q))
    direct.sort((a, b) => {
      const aStarts = a.startsWith(q) ? 0 : 1
      const bStarts = b.startsWith(q) ? 0 : 1
      if (aStarts !== bStarts) return aStarts - bStarts
      const aBase = a === `${q}USDT` ? 0 : 1
      const bBase = b === `${q}USDT` ? 0 : 1
      if (aBase !== bBase) return aBase - bBase
      return a.length - b.length || a.localeCompare(b)
    })
    return direct.slice(0, 60)
  }, [query, allSymbols])

  useEffect(() => {
    if (!open) return
    const missing = results.filter((s) => !requested.current.has(s)).slice(0, 40)
    if (missing.length === 0) return
    const timer = window.setTimeout(() => {
      for (const s of missing) requested.current.add(s)
      fetchTickers(missing)
        .then((rows) => {
          setTickers((prev) => {
            const next = { ...prev }
            for (const t of rows) next[t.symbol] = t
            return next
          })
        })
        .catch(() => {
          for (const s of missing) requested.current.delete(s)
        })
    }, 220)
    return () => window.clearTimeout(timer)
  }, [results, open])

  if (!open) return null

  return (
    <div className="overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal symbol-modal" role="dialog" aria-modal="true" aria-label="Elegir símbolo">
        <div className="modal-head">
          <h2>Mercados</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <CloseIcon />
          </button>
        </div>
        <div className="search-box">
          <SearchIcon size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar BTC, ETH, SOL…"
            autoComplete="off"
            spellCheck={false}
            aria-label="Buscar símbolo"
          />
          {query && (
            <button type="button" className="icon-btn small" onClick={() => setQuery('')} aria-label="Limpiar">
              <CloseIcon size={14} />
            </button>
          )}
        </div>
        <div className="symbol-list" role="listbox" aria-label="Símbolos">
          {results.map((symbol) => {
            const t = tickers[symbol]
            const up = (t?.changePct ?? 0) >= 0
            return (
              <button
                key={symbol}
                type="button"
                role="option"
                aria-selected={symbol === current}
                className={`symbol-row${symbol === current ? ' selected' : ''}`}
                onClick={() => {
                  onSelect(symbol)
                  onClose()
                }}
              >
                <span className="symbol-main">
                  <span className="symbol-name">{baseAsset(symbol)}</span>
                  <span className="symbol-quote">/{symbol.endsWith('USDT') ? 'USDT' : ''}</span>
                </span>
                <span className="symbol-meta">
                  <span className="mono">{t ? fmtPrice(t.last) : '—'}</span>
                  <span className={`change mono ${up ? 'up' : 'down'}`}>
                    {t ? fmtPct(t.changePct) : '—'}
                  </span>
                </span>
              </button>
            )
          })}
          {results.length === 0 && (
            <p className="empty-note">
              {loading && allSymbols.length === 0
                ? 'Cargando mercados…'
                : error
                  ? error
                  : 'Sin resultados para tu búsqueda.'}
            </p>
          )}
        </div>
        <p className="modal-foot">Datos públicos de Binance · respaldo Pionex</p>
      </div>
    </div>
  )
}
