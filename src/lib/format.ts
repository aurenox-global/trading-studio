/** Number/date formatting helpers. Locale-independent, tabular-friendly. */

const decimalsFor = (price: number): number => {
  const abs = Math.abs(price)
  if (abs >= 1000) return 2
  if (abs >= 100) return 3
  if (abs >= 1) return 4
  if (abs >= 0.01) return 5
  if (abs >= 0.0001) return 6
  return 8
}

export function fmtPrice(price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price)) return '—'
  return price.toLocaleString('en-US', {
    minimumFractionDigits: decimalsFor(price),
    maximumFractionDigits: decimalsFor(price),
  })
}

export function fmtMoney(value: number | null | undefined, decimals = 2): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function fmtSigned(value: number | null | undefined, decimals = 2): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return sign + fmtMoney(Math.abs(value), decimals)
}

export function fmtPct(value: number | null | undefined, decimals = 2): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${Math.abs(value).toFixed(decimals)}%`
}

export function fmtQty(qty: number | null | undefined): string {
  if (qty == null || !Number.isFinite(qty)) return '—'
  if (qty === 0) return '0'
  const abs = Math.abs(qty)
  const decimals = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 5 : 8
  return qty.toLocaleString('en-US', { maximumFractionDigits: decimals })
}

export function fmtCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return fmtMoney(value, 0)
}

export function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

export function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function baseAsset(symbol: string): string {
  return symbol.replace(/USDT$/, '')
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
