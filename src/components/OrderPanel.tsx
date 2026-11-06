import { useEffect, useMemo, useState } from 'react'
import { fetchTicker } from '../lib/binance'
import { baseAsset, fmtMoney, fmtPrice, fmtQty } from '../lib/format'
import { FEE_RATE, paper, TradeError, usePaperAccount, type Side } from '../lib/paperTrading'
import { usePrice } from '../lib/ws'
import { ArrowDownIcon, ArrowUpIcon, BoltIcon, ChevronDownIcon } from './Icons'

interface Props {
  symbol: string
  onOpenSymbols: () => void
}

export default function OrderPanel({ symbol, onOpenSymbols }: Props) {
  const account = usePaperAccount()
  const livePrice = usePrice(symbol)
  const [restPrice, setRestPrice] = useState<number | null>(null)
  const [side, setSide] = useState<Side>('long')
  const [unit, setUnit] = useState<'usdt' | 'qty'>('usdt')
  const [size, setSize] = useState('')
  const [leverage, setLeverage] = useState(5)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    setRestPrice(null)
    let cancelled = false
    fetchTicker(symbol)
      .then((t) => {
        if (!cancelled) setRestPrice(t.last)
      })
      .catch(() => {
        /* live price may still exist */
      })
    return () => {
      cancelled = true
    }
  }, [symbol])

  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(null), 3200)
    return () => window.clearTimeout(timer)
  }, [message])

  const mark = livePrice ?? restPrice
  const sizeNum = Number(size.replace(',', '.')) || 0
  const notional = unit === 'usdt' ? sizeNum : sizeNum * (mark ?? 0)
  const qty = mark && mark > 0 ? notional / mark : 0
  const margin = notional / leverage
  const fee = notional * FEE_RATE
  const required = margin + fee
  const insufficient = required > account.cash + 1e-9
  const maxUsdt = useMemo(() => Math.max(0, account.cash * 0.999 * leverage), [account.cash, leverage])

  const fillPct = (pct: number) => {
    const amount = maxUsdt * pct
    if (unit === 'usdt') setSize(amount >= 1 ? amount.toFixed(2) : '')
    else if (mark) setSize((amount / mark).toFixed(6))
  }

  const submit = () => {
    if (!mark) {
      setMessage({ kind: 'error', text: 'Esperando precio de mercado…' })
      return
    }
    try {
      paper.open({ symbol, side, size: sizeNum, unit, leverage, price: mark })
      setMessage({
        kind: 'ok',
        text: `${side === 'long' ? 'Long' : 'Short'} abierto en ${baseAsset(symbol)} a ${fmtPrice(mark)}`,
      })
      setSize('')
    } catch (err) {
      setMessage({
        kind: 'error',
        text: err instanceof TradeError ? err.message : 'No se pudo abrir la posición',
      })
    }
  }

  return (
    <div className="order-panel">
      <div className="panel-head">
        <h2 className="panel-title">Operar</h2>
        <span className="demo-pill">
          <BoltIcon size={12} /> demo
        </span>
      </div>

      <button type="button" className="order-symbol" onClick={onOpenSymbols}>
        <span className="order-symbol-name">{baseAsset(symbol)}<span className="muted">/USDT</span></span>
        <span className="order-symbol-price mono">
          {mark ? fmtPrice(mark) : '—'}
          <ChevronDownIcon size={14} />
        </span>
      </button>

      <div className="side-toggle" role="group" aria-label="Dirección">
        <button
          type="button"
          className={`side-btn long${side === 'long' ? ' active' : ''}`}
          aria-pressed={side === 'long'}
          onClick={() => setSide('long')}
        >
          <ArrowUpIcon size={15} /> Long
        </button>
        <button
          type="button"
          className={`side-btn short${side === 'short' ? ' active' : ''}`}
          aria-pressed={side === 'short'}
          onClick={() => setSide('short')}
        >
          <ArrowDownIcon size={15} /> Short
        </button>
      </div>

      <div className="field">
        <div className="field-label">
          <span>Tamaño</span>
          <div className="unit-toggle">
            <button type="button" className={unit === 'usdt' ? 'active' : ''} onClick={() => { setUnit('usdt'); setSize('') }}>
              USDT
            </button>
            <button type="button" className={unit === 'qty' ? 'active' : ''} onClick={() => { setUnit('qty'); setSize('') }}>
              {baseAsset(symbol)}
            </button>
          </div>
        </div>
        <div className={`input-wrap${insufficient ? ' invalid' : ''}`}>
          <input
            value={size}
            onChange={(e) => setSize(e.target.value.replace(/[^0-9.,]/g, ''))}
            inputMode="decimal"
            placeholder="0.00"
            aria-label={unit === 'usdt' ? 'Tamaño en USDT' : 'Cantidad'}
          />
          <span className="input-suffix">{unit === 'usdt' ? 'USDT' : baseAsset(symbol)}</span>
          <button type="button" className="max-btn" onClick={() => fillPct(1)}>
            MAX
          </button>
        </div>
        <div className="quick-row">
          {[0.25, 0.5, 0.75, 1].map((p) => (
            <button key={p} type="button" className="quick-chip" onClick={() => fillPct(p)}>
              {p * 100}%
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <div className="field-label">
          <span>Apalancamiento</span>
          <span className="mono leverage-value">{leverage}x</span>
        </div>
        <input
          type="range"
          min={1}
          max={20}
          step={1}
          value={leverage}
          onChange={(e) => setLeverage(Number(e.target.value))}
          className="range"
          aria-label="Apalancamiento"
        />
        <div className="quick-row leverage-chips">
          {[1, 3, 5, 10, 20].map((l) => (
            <button key={l} type="button" className={`quick-chip${leverage === l ? ' active' : ''}`} onClick={() => setLeverage(l)}>
              {l}x
            </button>
          ))}
        </div>
      </div>

      <dl className="order-summary">
        <div>
          <dt>Cantidad</dt>
          <dd className="mono">{qty > 0 ? fmtQty(qty) : '—'}</dd>
        </div>
        <div>
          <dt>Margen</dt>
          <dd className="mono">{margin > 0 ? `${fmtMoney(margin)} USDT` : '—'}</dd>
        </div>
        <div>
          <dt>Comisión</dt>
          <dd className="mono">{fee > 0 ? `${fmtMoney(fee, 2)} USDT` : '—'}</dd>
        </div>
        <div>
          <dt>Disponible</dt>
          <dd className="mono">{fmtMoney(account.cash)} USDT</dd>
        </div>
      </dl>

      <button
        type="button"
        className={`submit-btn ${side}`}
        onClick={submit}
        disabled={sizeNum <= 0 || !mark}
      >
        {side === 'long' ? 'Abrir Long' : 'Abrir Short'}
        {notional > 0 ? <span className="submit-sub">{fmtMoney(notional)} USDT</span> : null}
      </button>

      {message && <p className={`form-msg ${message.kind}`}>{message.text}</p>}
      <p className="disclaimer">Cuenta demo con 10.000 USDT virtuales. Sin dinero real ni claves API.</p>
    </div>
  )
}
