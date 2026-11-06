/**
 * Demo (paper) trading engine. No backend, no API keys, no real money.
 * Pure account functions + a tiny observable store persisted in localStorage.
 */
import { useSyncExternalStore } from 'react'

export const START_BALANCE = 10_000
export const FEE_RATE = 0.0004 // 0.04% taker fee (demo)
export const MAX_LEVERAGE = 20
const STORAGE_KEY = 'ts:account:v1'

export type Side = 'long' | 'short'
export type Market = 'spot' | 'futures'

export interface Position {
  id: string
  symbol: string
  side: Side
  market: Market
  qty: number
  entry: number
  leverage: number
  margin: number
  openFee: number
  openedAt: number
}

export interface ClosedTrade {
  id: string
  symbol: string
  side: Side
  market: Market
  qty: number
  entry: number
  exit: number
  leverage: number
  pnl: number
  fee: number
  openedAt: number
  closedAt: number
  liquidated?: boolean
}

export interface Account {
  startBalance: number
  cash: number
  positions: Position[]
  history: ClosedTrade[]
}

export function createAccount(): Account {
  return { startBalance: START_BALANCE, cash: START_BALANCE, positions: [], history: [] }
}

export function unrealizedPnl(p: Position, mark: number): number {
  const diff = p.side === 'long' ? mark - p.entry : p.entry - mark
  return diff * p.qty
}

export function liquidationPrice(p: Position): number {
  const factor = 1 / p.leverage
  return p.side === 'long' ? p.entry * (1 - factor) : p.entry * (1 + factor)
}

export function positionEquity(p: Position, mark: number): number {
  return p.margin + unrealizedPnl(p, mark)
}

export function accountEquity(account: Account, prices: Record<string, number>): number {
  return account.positions.reduce((acc, p) => {
    const mark = prices[p.symbol]
    return acc + (mark ? positionEquity(p, mark) : p.margin)
  }, account.cash)
}

export function realizedPnl(account: Account): number {
  return account.history.reduce((acc, t) => acc + t.pnl - t.fee, 0)
}

export function usedMargin(account: Account): number {
  return account.positions.reduce((acc, p) => acc + p.margin, 0)
}

export interface OpenParams {
  symbol: string
  side: Side
  market?: Market
  size: number
  unit: 'usdt' | 'qty'
  leverage: number
  price: number
}

export class TradeError extends Error {}

export function openPosition(
  account: Account,
  params: OpenParams,
  now = Date.now(),
  id = makeId(),
): { account: Account; position: Position } {
  const { symbol, side, size, unit, price } = params
  const market: Market = params.market === 'spot' ? 'spot' : 'futures'
  const leverage = market === 'spot' ? 1 : Math.round(params.leverage)
  if (!Number.isFinite(price) || price <= 0) throw new TradeError('Precio de mercado no disponible')
  if (!Number.isFinite(size) || size <= 0) throw new TradeError('Indica un tamaño mayor que 0')
  if (leverage < 1 || leverage > MAX_LEVERAGE) {
    throw new TradeError(`El apalancamiento debe estar entre 1x y ${MAX_LEVERAGE}x`)
  }
  const notional = unit === 'usdt' ? size : size * price
  const qty = notional / price
  const margin = notional / leverage
  const openFee = notional * FEE_RATE
  const required = margin + openFee
  if (required > account.cash + 1e-9) {
    throw new TradeError(
      `Saldo insuficiente: necesitas ${required.toFixed(2)} USDT y disponibles ${account.cash.toFixed(2)} USDT`,
    )
  }
  if (notional < 1) throw new TradeError('El tamaño mínimo es 1 USDT')
  const position: Position = {
    id,
    symbol,
    side,
    market,
    qty,
    entry: price,
    leverage,
    margin,
    openFee,
    openedAt: now,
  }
  return {
    account: { ...account, cash: account.cash - required, positions: [position, ...account.positions] },
    position,
  }
}

export function closePosition(
  account: Account,
  positionId: string,
  price: number,
  now = Date.now(),
  liquidated = false,
): { account: Account; trade: ClosedTrade } {
  const position = account.positions.find((p) => p.id === positionId)
  if (!position) throw new TradeError('Posición no encontrada')
  if (!Number.isFinite(price) || price <= 0) throw new TradeError('Precio de mercado no disponible')
  const pnl = unrealizedPnl(position, price)
  const closeFee = position.qty * price * FEE_RATE
  const returned = Math.max(0, position.margin + pnl - closeFee)
  const trade: ClosedTrade = {
    id: position.id,
    symbol: position.symbol,
    side: position.side,
    market: position.market ?? 'futures',
    qty: position.qty,
    entry: position.entry,
    exit: price,
    leverage: position.leverage,
    pnl,
    fee: position.openFee + closeFee,
    openedAt: position.openedAt,
    closedAt: now,
    liquidated,
  }
  return {
    account: {
      ...account,
      cash: account.cash + returned,
      positions: account.positions.filter((p) => p.id !== positionId),
      history: [trade, ...account.history].slice(0, 200),
    },
    trade,
  }
}

/** Close any position whose loss has eaten ~98% of its margin (demo liquidation). */
export function liquidateIfNeeded(
  account: Account,
  prices: Record<string, number>,
): { account: Account; liquidated: ClosedTrade[] } {
  let next = account
  const liquidated: ClosedTrade[] = []
  for (const p of account.positions) {
    const mark = prices[p.symbol]
    if (!mark) continue
    if (unrealizedPnl(p, mark) <= -p.margin * 0.98) {
      const res = closePosition(next, p.id, liquidationPrice(p), Date.now(), true)
      next = res.account
      liquidated.push(res.trade)
    }
  }
  return { account: next, liquidated }
}

export function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function sanitize(raw: unknown): Account {
  const fallback = createAccount()
  if (!raw || typeof raw !== 'object') return fallback
  const a = raw as Partial<Account>
  if (typeof a.cash !== 'number' || !Number.isFinite(a.cash)) return fallback
  return {
    startBalance: typeof a.startBalance === 'number' ? a.startBalance : START_BALANCE,
    cash: a.cash,
    positions: Array.isArray(a.positions)
      ? (a.positions as Position[]).map((p) => ({ ...p, market: p.market === 'spot' ? 'spot' : 'futures' }))
      : [],
    history: Array.isArray(a.history)
      ? (a.history.slice(0, 200) as ClosedTrade[]).map((t) => ({
          ...t,
          market: t.market === 'spot' ? 'spot' : 'futures',
        }))
      : [],
  }
}

class PaperStore {
  private state: Account
  private listeners = new Set<() => void>()

  constructor() {
    this.state = this.load()
  }

  private load(): Account {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return createAccount()
      return sanitize(JSON.parse(raw))
    } catch {
      return createAccount()
    }
  }

  private persist(state: Account): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* storage full or unavailable: keep in-memory */
    }
  }

  getSnapshot = (): Account => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private commit(next: Account): void {
    this.state = next
    this.persist(next)
    for (const l of this.listeners) l()
  }

  open(params: OpenParams): Position {
    const { account, position } = openPosition(this.state, params)
    this.commit(account)
    return position
  }

  close(positionId: string, price: number): ClosedTrade {
    const { account, trade } = closePosition(this.state, positionId, price)
    this.commit(account)
    return trade
  }

  closeSpot(symbol: string, price: number): ClosedTrade[] {
    const ids = this.state.positions.filter((p) => p.market === 'spot' && p.symbol === symbol).map((p) => p.id)
    if (ids.length === 0) return []
    let account = this.state
    const trades: ClosedTrade[] = []
    for (const id of ids) {
      const res = closePosition(account, id, price)
      account = res.account
      trades.push(res.trade)
    }
    this.commit(account)
    return trades
  }

  liquidate(prices: Record<string, number>): void {
    const { account, liquidated } = liquidateIfNeeded(this.state, prices)
    if (liquidated.length > 0) this.commit(account)
  }

  reset(): void {
    this.commit(createAccount())
  }
}

export const paper = new PaperStore()

export function usePaperAccount(): Account {
  return useSyncExternalStore(paper.subscribe, paper.getSnapshot, paper.getSnapshot)
}
