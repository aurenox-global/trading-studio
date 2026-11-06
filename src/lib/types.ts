export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d'

export const TIMEFRAMES: readonly Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d']

export type LayoutId = '1x1' | '2x1' | '1x2' | '2x2' | '3'

export interface LayoutDef {
  id: LayoutId
  label: string
  panes: number
}

export const LAYOUTS: readonly LayoutDef[] = [
  { id: '1x1', label: '1', panes: 1 },
  { id: '2x1', label: '2', panes: 2 },
  { id: '1x2', label: '2', panes: 2 },
  { id: '3', label: '3', panes: 3 },
  { id: '2x2', label: '4', panes: 4 },
]

export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface Ticker {
  symbol: string
  last: number
  changePct: number
  quoteVolume: number
}

export interface PaneState {
  id: string
  symbol: string
  timeframe: Timeframe
  ema: boolean
  rsi: boolean
  volume: boolean
  maximized?: boolean
}

export const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'] as const

export const POPULAR_SYMBOLS: readonly string[] = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'ADAUSDT',
  'AVAXUSDT',
  'LINKUSDT',
  'TONUSDT',
  'SUIUSDT',
  'DOTUSDT',
  'TRXUSDT',
  'LTCUSDT',
  'NEARUSDT',
  'APTUSDT',
  'ARBUSDT',
  'OPUSDT',
  'INJUSDT',
  'SEIUSDT',
  'TIAUSDT',
  'ATOMUSDT',
  'UNIUSDT',
  'ETCUSDT',
  'FILUSDT',
  'AAVEUSDT',
  'RENDERUSDT',
  'FETUSDT',
  'WIFUSDT',
  'PEPEUSDT',
  'SHIBUSDT',
  'BONKUSDT',
]
