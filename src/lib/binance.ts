/**
 * Free public market data, no keys, no paid APIs.
 *
 * Provider chain: Binance (primary) -> Pionex (documented fallback)
 * -> OKX (CORS-enabled browser fallback).
 *
 * Pionex's public API does not send Access-Control-Allow-Origin, so a browser
 * cannot read it cross-origin; OKX is the last resort that works in a static
 * site. All three are public and keyless.
 */
import type { Candle, Ticker, Timeframe } from './types'

const BINANCE_REST = 'https://api.binance.com'
const PIONEX_REST = 'https://api.pionex.com/api/v1'
const OKX_REST = 'https://www.okx.com'

const PIONEX_INTERVAL: Record<Timeframe, string> = {
  '1m': '1M',
  '5m': '5M',
  '15m': '15M',
  '1h': '60M',
  '4h': '4H',
  '1d': '1D',
}

const OKX_INTERVAL: Record<Timeframe, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1H',
  '4h': '4H',
  '1d': '1D',
}

export type DataSource = 'binance' | 'pionex' | 'okx'

export const SOURCE_LABEL: Record<DataSource, string> = {
  binance: 'Binance',
  pionex: 'Pionex',
  okx: 'OKX',
}

let activeSource: DataSource = 'binance'
const sourceListeners = new Set<(source: DataSource) => void>()

export function getDataSource(): DataSource {
  return activeSource
}

export function subscribeDataSource(fn: (source: DataSource) => void): () => void {
  sourceListeners.add(fn)
  return () => {
    sourceListeners.delete(fn)
  }
}

function setSource(source: DataSource): void {
  if (activeSource === source) return
  activeSource = source
  for (const fn of sourceListeners) fn(source)
}

const CACHE_PREFIX = 'ts:candles:v1:'
const memoryCache = new Map<string, Candle[]>()

function cacheKey(symbol: string, tf: Timeframe): string {
  return `${symbol}:${tf}`
}

export function getCachedCandles(symbol: string, tf: Timeframe): Candle[] | null {
  const key = cacheKey(symbol, tf)
  const mem = memoryCache.get(key)
  if (mem && mem.length > 0) return mem
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Candle[]
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    memoryCache.set(key, parsed)
    return parsed
  } catch {
    return null
  }
}

function cacheCandles(symbol: string, tf: Timeframe, candles: Candle[]): void {
  const key = cacheKey(symbol, tf)
  const trimmed = candles.slice(-300)
  memoryCache.set(key, trimmed)
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(trimmed))
  } catch {
    /* ignore quota errors */
  }
}

async function getJson(url: string, timeoutMs = 12_000): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

type BinanceKline = [number, string, string, string, string, string, ...unknown[]]

function mapBinanceKlines(rows: BinanceKline[]): Candle[] {
  return rows.map((r) => ({
    time: Math.floor(r[0] / 1000),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5]),
  }))
}

export function toPionexSymbol(symbol: string): string {
  return symbol.endsWith('USDT') ? `${symbol.slice(0, -4)}_USDT` : symbol
}

export function fromPionexSymbol(symbol: string): string {
  return symbol.endsWith('_USDT') ? `${symbol.slice(0, -5)}USDT` : symbol
}

export function toOkxSymbol(symbol: string): string {
  return symbol.endsWith('USDT') ? `${symbol.slice(0, -4)}-USDT` : symbol
}

export function fromOkxSymbol(instId: string): string {
  return instId.endsWith('-USDT') ? `${instId.slice(0, -5)}USDT` : instId
}

/* ------------------------------- Binance ------------------------------- */

async function fetchKlinesBinance(symbol: string, tf: Timeframe, limit: number): Promise<Candle[]> {
  const url = `${BINANCE_REST}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${tf}&limit=${limit}`
  const rows = (await getJson(url)) as BinanceKline[]
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Binance: sin datos')
  return mapBinanceKlines(rows)
}

/* -------------------------------- Pionex ------------------------------- */

async function fetchKlinesPionex(symbol: string, tf: Timeframe, limit: number): Promise<Candle[]> {
  const url = `${PIONEX_REST}/market/klines?symbol=${encodeURIComponent(
    toPionexSymbol(symbol),
  )}&interval=${PIONEX_INTERVAL[tf]}&limit=${Math.min(limit, 500)}`
  const json = (await getJson(url, 8000)) as {
    result?: boolean
    data?: { klines?: { time: number; open: string; close: string; high: string; low: string; volume: string }[] }
  }
  if (!json?.result || !json.data?.klines?.length) throw new Error('Pionex: sin datos')
  return json.data.klines
    .slice()
    .sort((a, b) => a.time - b.time)
    .map((k) => ({
      time: Math.floor(k.time / 1000),
      open: Number(k.open),
      high: Number(k.high),
      low: Number(k.low),
      close: Number(k.close),
      volume: Number(k.volume),
    }))
}

/* --------------------------------- OKX --------------------------------- */

async function fetchKlinesOkx(symbol: string, tf: Timeframe, limit: number): Promise<Candle[]> {
  const url = `${OKX_REST}/api/v5/market/candles?instId=${encodeURIComponent(
    toOkxSymbol(symbol),
  )}&bar=${OKX_INTERVAL[tf]}&limit=${Math.min(limit, 300)}`
  const json = (await getJson(url, 8000)) as { code?: string; data?: string[][] }
  if (json?.code !== '0' || !json.data?.length) throw new Error('OKX: sin datos')
  return json.data
    .map((k) => ({
      time: Math.floor(Number(k[0]) / 1000),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
    }))
    .sort((a, b) => a.time - b.time)
}

/* ------------------------------ klines API ----------------------------- */

export async function fetchKlines(symbol: string, tf: Timeframe, limit = 500): Promise<Candle[]> {
  const providers: { source: DataSource; run: () => Promise<Candle[]> }[] = [
    { source: 'binance', run: () => fetchKlinesBinance(symbol, tf, limit) },
    { source: 'pionex', run: () => fetchKlinesPionex(symbol, tf, limit) },
    { source: 'okx', run: () => fetchKlinesOkx(symbol, tf, limit) },
  ]
  let lastError: unknown = null
  for (const provider of providers) {
    try {
      const candles = await provider.run()
      setSource(provider.source)
      cacheCandles(symbol, tf, candles)
      return candles
    } catch (err) {
      lastError = err
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Sin datos de mercado')
}

/* ------------------------------ tickers -------------------------------- */

type BinanceTicker = {
  symbol: string
  lastPrice: string
  priceChangePercent: string
  quoteVolume: string
}

export async function fetchTicker(symbol: string): Promise<Ticker> {
  try {
    const url = `${BINANCE_REST}/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`
    const t = (await getJson(url, 10_000)) as BinanceTicker
    setSource('binance')
    return {
      symbol: t.symbol,
      last: Number(t.lastPrice),
      changePct: Number(t.priceChangePercent),
      quoteVolume: Number(t.quoteVolume),
    }
  } catch {
    /* next provider */
  }

  try {
    const url = `${PIONEX_REST}/market/tickers`
    const json = (await getJson(url, 8000)) as {
      result?: boolean
      data?: { tickers?: { symbol: string; open: string; close: string; amount: string }[] }
    }
    if (!json?.result || !json.data?.tickers) throw new Error('Pionex: sin datos')
    const wanted = toPionexSymbol(symbol)
    const t = json.data.tickers.find((x) => x.symbol === wanted)
    if (!t) throw new Error(`Símbolo ${symbol} no disponible`)
    const last = Number(t.close)
    const open = Number(t.open)
    setSource('pionex')
    return {
      symbol,
      last,
      changePct: open > 0 ? ((last - open) / open) * 100 : 0,
      quoteVolume: Number(t.amount),
    }
  } catch {
    /* next provider */
  }

  const url = `${OKX_REST}/api/v5/market/ticker?instId=${encodeURIComponent(toOkxSymbol(symbol))}`
  const json = (await getJson(url, 8000)) as {
    code?: string
    data?: { last: string; open24h: string; volCcy24h: string }[]
  }
  const t = json?.data?.[0]
  if (json?.code !== '0' || !t) throw new Error(`Sin datos para ${symbol}`)
  const last = Number(t.last)
  const open = Number(t.open24h)
  setSource('okx')
  return {
    symbol,
    last,
    changePct: open > 0 ? ((last - open) / open) * 100 : 0,
    quoteVolume: Number(t.volCcy24h),
  }
}

export async function fetchTickers(symbols: string[]): Promise<Ticker[]> {
  const unique = [...new Set(symbols)]
  if (unique.length === 0) return []

  try {
    const list = JSON.stringify(unique)
    const url = `${BINANCE_REST}/api/v3/ticker/24hr?symbols=${encodeURIComponent(list)}`
    const rows = (await getJson(url, 12_000)) as BinanceTicker[]
    setSource('binance')
    return rows.map((t) => ({
      symbol: t.symbol,
      last: Number(t.lastPrice),
      changePct: Number(t.priceChangePercent),
      quoteVolume: Number(t.quoteVolume),
    }))
  } catch {
    /* next provider */
  }

  try {
    const json = (await getJson(`${PIONEX_REST}/market/tickers`, 10_000)) as {
      result?: boolean
      data?: { tickers?: { symbol: string; open: string; close: string; amount: string }[] }
    }
    if (!json?.result || !json.data?.tickers) throw new Error('Pionex: sin datos')
    const bySymbol = new Map(json.data.tickers.map((t) => [t.symbol, t]))
    setSource('pionex')
    return unique.flatMap((symbol) => {
      const t = bySymbol.get(toPionexSymbol(symbol))
      if (!t) return []
      const last = Number(t.close)
      const open = Number(t.open)
      return [
        {
          symbol,
          last,
          changePct: open > 0 ? ((last - open) / open) * 100 : 0,
          quoteVolume: Number(t.amount),
        },
      ]
    })
  } catch {
    /* next provider */
  }

  const json = (await getJson(`${OKX_REST}/api/v5/market/tickers?instType=SPOT`, 10_000)) as {
    code?: string
    data?: { instId: string; last: string; open24h: string; volCcy24h: string }[]
  }
  if (json?.code !== '0' || !json.data) throw new Error('Sin datos de mercado')
  const bySymbol = new Map(json.data.map((t) => [t.instId, t]))
  setSource('okx')
  return unique.flatMap((symbol) => {
    const t = bySymbol.get(toOkxSymbol(symbol))
    if (!t) return []
    const last = Number(t.last)
    const open = Number(t.open24h)
    return [
      {
        symbol,
        last,
        changePct: open > 0 ? ((last - open) / open) * 100 : 0,
        quoteVolume: Number(t.volCcy24h),
      },
    ]
  })
}

/* ------------------------------ symbols -------------------------------- */

const SYMBOLS_KEY = 'ts:symbols:v1'
let symbolsPromise: Promise<string[]> | null = null

async function fetchSymbolsBinance(): Promise<string[]> {
  const url = `${BINANCE_REST}/api/v3/exchangeInfo?permissions=SPOT`
  const json = (await getJson(url, 20_000)) as {
    symbols?: { symbol: string; status: string; quoteAsset: string }[]
  }
  if (!json?.symbols) throw new Error('exchangeInfo vacío')
  const list = json.symbols
    .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
    .map((s) => s.symbol)
    .sort()
  if (list.length === 0) throw new Error('sin símbolos')
  return list
}

async function fetchSymbolsOkx(): Promise<string[]> {
  const json = (await getJson(`${OKX_REST}/api/v5/public/instruments?instType=SPOT`, 15_000)) as {
    code?: string
    data?: { instId: string; quoteCcy: string; state: string }[]
  }
  if (json?.code !== '0' || !json.data) throw new Error('OKX: sin instrumentos')
  return json.data
    .filter((s) => s.state === 'live' && s.quoteCcy === 'USDT')
    .map((s) => fromOkxSymbol(s.instId))
    .sort()
}

export function fetchSymbols(): Promise<string[]> {
  if (symbolsPromise) return symbolsPromise
  symbolsPromise = (async () => {
    try {
      const list = await fetchSymbolsBinance()
      try {
        localStorage.setItem(SYMBOLS_KEY, JSON.stringify({ at: Date.now(), list }))
      } catch {
        /* ignore */
      }
      setSource('binance')
      return list
    } catch {
      /* next provider */
    }

    try {
      const raw = localStorage.getItem(SYMBOLS_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as { list?: string[] }
        if (parsed.list?.length) return parsed.list
      }
    } catch {
      /* ignore */
    }

    try {
      const json = (await getJson(`${PIONEX_REST}/market/tickers`, 10_000)) as {
        result?: boolean
        data?: { tickers?: { symbol: string }[] }
      }
      const list = (json.data?.tickers ?? [])
        .map((t) => t.symbol)
        .filter((s) => s.endsWith('_USDT'))
        .map(fromPionexSymbol)
        .sort()
      setSource('pionex')
      return list
    } catch {
      /* next provider */
    }

    try {
      const list = await fetchSymbolsOkx()
      setSource('okx')
      return list
    } catch {
      return []
    }
  })()
  return symbolsPromise
}

export function resetProviderState(): void {
  symbolsPromise = null
  memoryCache.clear()
}
