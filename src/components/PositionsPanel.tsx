import { useEffect, useState } from 'react'
import { fmtDateTime, fmtMoney, fmtPct, fmtPrice, fmtQty, fmtSigned } from '../lib/format'
import {
  accountEquity,
  liquidationPrice,
  paper,
  realizedPnl,
  unrealizedPnl,
  usedMargin,
  usePaperAccount,
  type Position,
} from '../lib/paperTrading'
import { prices, usePrice } from '../lib/ws'
import { ArrowDownIcon, ArrowUpIcon, TrashIcon } from './Icons'

function PositionRow({ position }: { position: Position }) {
  const live = usePrice(position.symbol)
  const mark = live ?? position.entry
  const pnl = unrealizedPnl(position, mark)
  const pct = position.margin > 0 ? (pnl / position.margin) * 100 : 0
  const liq = liquidationPrice(position)

  return (
    <li className="position-row">
      <div className="pos-top">
        <span className={`side-badge ${position.side}`}>
          {position.side === 'long' ? <ArrowUpIcon size={11} /> : <ArrowDownIcon size={11} />}
          {position.side === 'long' ? 'LONG' : 'SHORT'}
        </span>
        <span className="pos-symbol">{position.symbol.replace(/USDT$/, '')}<span className="muted">/USDT</span></span>
        <span className="pos-lev">{position.market === 'spot' ? 'SPOT' : `${position.leverage}x`}</span>
        <button
          type="button"
          className="close-pos"
          onClick={() => paper.close(position.id, mark)}
          aria-label={`Cerrar posición ${position.symbol}`}
        >
          Cerrar
        </button>
      </div>
      <div className="pos-grid mono">
        <div>
          <span className="k">Cantidad</span>
          <span className="v">{fmtQty(position.qty)}</span>
        </div>
        <div>
          <span className="k">Entrada</span>
          <span className="v">{fmtPrice(position.entry)}</span>
        </div>
        <div>
          <span className="k">Marca</span>
          <span className="v">{fmtPrice(mark)}</span>
        </div>
        <div>
          <span className="k">Liq.</span>
          <span className="v muted">{fmtPrice(liq)}</span>
        </div>
      </div>
      <div className="pos-pnl">
        <span className={`mono ${pnl >= 0 ? 'up' : 'down'}`}>{fmtSigned(pnl)} USDT</span>
        <span className={`mono small ${pnl >= 0 ? 'up' : 'down'}`}>{fmtPct(pct)}</span>
      </div>
    </li>
  )
}

export default function PositionsPanel() {
  const account = usePaperAccount()
  const [, setTick] = useState(0)
  const [confirmReset, setConfirmReset] = useState(false)
  const [showAllHistory, setShowAllHistory] = useState(false)

  useEffect(() => {
    const unsub = prices.subscribe(() => setTick((t) => t + 1))
    return () => {
      unsub()
    }
  }, [])

  useEffect(() => {
    if (!confirmReset) return
    const timer = window.setTimeout(() => setConfirmReset(false), 4000)
    return () => window.clearTimeout(timer)
  }, [confirmReset])

  const map = prices.snapshot()
  const equity = accountEquity(account, map)
  const upnl = account.positions.reduce((acc, p) => acc + unrealizedPnl(p, map[p.symbol] ?? p.entry), 0)
  const totalPnl = equity - account.startBalance
  const realized = realizedPnl(account)
  const margin = usedMargin(account)
  const history = showAllHistory ? account.history : account.history.slice(0, 6)

  return (
    <div className="positions-panel">
      <div className="panel-head">
        <h2 className="panel-title">Cuenta demo</h2>
        <button
          type="button"
          className={`reset-btn${confirmReset ? ' confirm' : ''}`}
          onClick={() => {
            if (confirmReset) {
              paper.reset()
              setConfirmReset(false)
            } else {
              setConfirmReset(true)
            }
          }}
        >
          <TrashIcon size={13} />
          {confirmReset ? 'Confirmar' : 'Reiniciar'}
        </button>
      </div>

      <div className="stats-grid">
        <div className="stat wide">
          <span className="stat-k">Equity</span>
          <span className="stat-v mono">{fmtMoney(equity)} <small>USDT</small></span>
        </div>
        <div className="stat">
          <span className="stat-k">PnL no realizado</span>
          <span className={`stat-v mono ${upnl >= 0 ? 'up' : 'down'}`}>{fmtSigned(upnl)}</span>
        </div>
        <div className="stat">
          <span className="stat-k">PnL total</span>
          <span className={`stat-v mono ${totalPnl >= 0 ? 'up' : 'down'}`}>{fmtPct((totalPnl / account.startBalance) * 100)}</span>
        </div>
        <div className="stat">
          <span className="stat-k">Margen usado</span>
          <span className="stat-v mono">{fmtMoney(margin)}</span>
        </div>
        <div className="stat">
          <span className="stat-k">Realizado</span>
          <span className={`stat-v mono ${realized >= 0 ? 'up' : 'down'}`}>{fmtSigned(realized)}</span>
        </div>
      </div>

      <div className="section-head">
        <h3>Posiciones abiertas</h3>
        <span className="count-pill">{account.positions.length}</span>
      </div>
      {account.positions.length === 0 ? (
        <p className="empty-note">Sin posiciones. Usa el panel de operar para abrir un long o short.</p>
      ) : (
        <ul className="positions-list">
          {account.positions.map((p) => (
            <PositionRow key={p.id} position={p} />
          ))}
        </ul>
      )}

      <div className="section-head">
        <h3>Historial</h3>
        <span className="count-pill">{account.history.length}</span>
      </div>
      {account.history.length === 0 ? (
        <p className="empty-note">Todavía no cerraste ninguna operación.</p>
      ) : (
        <>
          <ul className="history-list">
            {history.map((t) => {
              const net = t.pnl - t.fee
              return (
                <li key={t.id} className="history-row">
                  <div className="hist-main">
                    <span className={`side-badge ${t.side}`}>{t.side === 'long' ? 'L' : 'S'}</span>
                    <span className="hist-symbol">{t.symbol.replace(/USDT$/, '')}</span>
                    <span className="muted small">{t.market === 'spot' ? 'SPOT' : `${t.leverage}x`}</span>
                    {t.liquidated && <span className="liq-tag">liq.</span>}
                  </div>
                  <div className="hist-meta">
                    <span className={`mono ${net >= 0 ? 'up' : 'down'}`}>{fmtSigned(net)} USDT</span>
                    <span className="muted small">{fmtDateTime(t.closedAt)}</span>
                  </div>
                </li>
              )
            })}
          </ul>
          {account.history.length > 6 && (
            <button type="button" className="link-btn" onClick={() => setShowAllHistory((v) => !v)}>
              {showAllHistory ? 'Mostrar menos' : `Ver todo (${account.history.length})`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
