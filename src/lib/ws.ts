/**
 * Live market streams over the Binance public WebSocket, with ref-counted
 * subscriptions, a single shared socket, and exponential backoff reconnects.
 */
import { useSyncExternalStore } from 'react'

const WS_BASE = 'wss://stream.binance.com:9443'

export type StreamStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'offline'

type Handler = (data: unknown) => void

export interface KlineEvent {
  e: 'kline'
  s: string
  k: {
    t: number
    T: number
    s: string
    i: string
    o: string
    c: string
    h: string
    l: string
    v: string
    x: boolean
    q: string
  }
}

export interface MiniTickerEvent {
  e: '24hrMiniTicker'
  s: string
  c: string
  o: string
  h: string
  l: string
  v: string
  q: string
}

export function klineStream(symbol: string, interval: string): string {
  return `${symbol.toLowerCase()}@kline_${interval}`
}

export function miniTickerStream(symbol: string): string {
  return `${symbol.toLowerCase()}@miniTicker`
}

class StreamHub {
  private handlers = new Map<string, Set<Handler>>()
  private statusListeners = new Set<(s: StreamStatus) => void>()
  private ws: WebSocket | null = null
  private retryTimer: number | undefined
  private attempt = 0
  private currentUrl = ''
  private disposed = false
  private activeStreams = new Set<string>()
  private reqId = 0

  status: StreamStatus = 'idle'

  subscribe(stream: string, handler: Handler): () => void {
    let set = this.handlers.get(stream)
    if (!set) {
      set = new Set()
      this.handlers.set(stream, set)
    }
    set.add(handler)
    this.sync()
    return () => {
      const current = this.handlers.get(stream)
      if (!current) return
      current.delete(handler)
      if (current.size === 0) this.handlers.delete(stream)
      this.sync()
    }
  }

  subscribeStatus(fn: (s: StreamStatus) => void): () => void {
    this.statusListeners.add(fn)
    return () => {
      this.statusListeners.delete(fn)
    }
  }

  private setStatus(next: StreamStatus): void {
    if (this.status === next) return
    this.status = next
    for (const fn of this.statusListeners) fn(next)
  }

  private url(): string {
    const streams = [...this.handlers.keys()].sort()
    if (streams.length === 0) return ''
    return `${WS_BASE}/stream?streams=${streams.join('/')}`
  }

  private sync(): void {
    if (this.disposed) return
    const wanted = [...this.handlers.keys()].sort()
    if (wanted.length === 0) {
      this.closeSocket()
      this.clearTimer()
      this.activeStreams.clear()
      this.currentUrl = ''
      this.setStatus('idle')
      return
    }
    // Already connected: subscribe/unsubscribe in place instead of reconnecting.
    if (this.ws?.readyState === WebSocket.OPEN) {
      const toAdd = wanted.filter((s) => !this.activeStreams.has(s))
      const toRemove = [...this.activeStreams].filter((s) => !this.handlers.has(s))
      if (toAdd.length > 0) this.send({ method: 'SUBSCRIBE', params: toAdd, id: ++this.reqId })
      if (toRemove.length > 0) this.send({ method: 'UNSUBSCRIBE', params: toRemove, id: ++this.reqId })
      this.activeStreams = new Set(wanted)
      this.currentUrl = this.url()
      return
    }
    if (this.ws?.readyState === WebSocket.CONNECTING) return
    this.currentUrl = this.url()
    this.attempt = 0
    this.open()
  }

  private send(payload: unknown): void {
    try {
      this.ws?.send(JSON.stringify(payload))
    } catch {
      /* socket closed between checks */
    }
  }

  private clearTimer(): void {
    if (this.retryTimer !== undefined) {
      window.clearTimeout(this.retryTimer)
      this.retryTimer = undefined
    }
  }

  private closeSocket(): void {
    const ws = this.ws
    this.ws = null
    if (!ws) return
    ws.onopen = null
    ws.onmessage = null
    ws.onerror = null
    ws.onclose = null
    try {
      ws.close()
    } catch {
      /* ignore */
    }
  }

  private open(): void {
    if (this.disposed || this.handlers.size === 0) return
    this.closeSocket()
    this.clearTimer()
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting')
    const connectStreams = [...this.handlers.keys()].sort()
    if (connectStreams.length === 0) return
    this.currentUrl = `${WS_BASE}/stream?streams=${connectStreams.join('/')}`
    let ws: WebSocket
    try {
      ws = new WebSocket(this.currentUrl)
    } catch {
      this.scheduleRetry()
      return
    }
    this.ws = ws
    ws.onopen = () => {
      if (this.ws !== ws) return
      this.attempt = 0
      this.activeStreams = new Set(connectStreams)
      this.setStatus('open')
      this.sync()
    }
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return
      try {
        const payload = JSON.parse(ev.data as string) as { stream?: string; data?: unknown }
        if (!payload?.stream) return
        const handlers = this.handlers.get(payload.stream)
        if (!handlers) return
        for (const h of handlers) h(payload.data)
      } catch {
        /* ignore malformed frame */
      }
    }
    ws.onerror = () => {
      /* onclose follows */
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      this.activeStreams.clear()
      if (this.handlers.size === 0) {
        this.setStatus('idle')
        return
      }
      this.scheduleRetry()
    }
  }

  private scheduleRetry(): void {
    this.clearTimer()
    this.attempt += 1
    if (this.attempt > 6) this.setStatus('offline')
    else this.setStatus('reconnecting')
    const delay = Math.min(30_000, 800 * 2 ** Math.min(this.attempt, 5)) + Math.random() * 400
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = undefined
      if (this.handlers.size > 0) {
        this.currentUrl = this.url()
        this.open()
      }
    }, delay)
  }

  dispose(): void {
    this.disposed = true
    this.closeSocket()
    this.clearTimer()
    this.handlers.clear()
  }
}

export const streams = new StreamHub()

const statusListeners = new Set<() => void>()
let currentStatus: StreamStatus = 'idle'
streams.subscribeStatus((s) => {
  currentStatus = s
  for (const fn of statusListeners) fn()
})

function subscribeStatus(fn: () => void): () => void {
  statusListeners.add(fn)
  return () => {
    statusListeners.delete(fn)
  }
}

export function useStreamStatus(): StreamStatus {
  return useSyncExternalStore(subscribeStatus, () => currentStatus, () => currentStatus)
}

/* ------------------------------ price store ------------------------------ */

const priceMap = new Map<string, number>()
const priceListeners = new Set<() => void>()
let lastNotify = 0
let notifyTimer: number | undefined

function notifyPrices(): void {
  const now = Date.now()
  if (now - lastNotify > 120) {
    lastNotify = now
    for (const fn of priceListeners) fn()
    return
  }
  if (notifyTimer !== undefined) return
  notifyTimer = window.setTimeout(() => {
    notifyTimer = undefined
    lastNotify = Date.now()
    for (const fn of priceListeners) fn()
  }, 120)
}

export const prices = {
  set(symbol: string, price: number): void {
    if (!Number.isFinite(price) || price <= 0) return
    if (priceMap.get(symbol) === price) return
    priceMap.set(symbol, price)
    notifyPrices()
  },
  get(symbol: string): number | undefined {
    return priceMap.get(symbol)
  },
  snapshot(): Record<string, number> {
    return Object.fromEntries(priceMap)
  },
  subscribe(fn: () => void): () => void {
    priceListeners.add(fn)
    return () => {
      priceListeners.delete(fn)
    }
  },
}

export function usePrice(symbol: string): number | undefined {
  return useSyncExternalStore(
    prices.subscribe,
    () => priceMap.get(symbol),
    () => priceMap.get(symbol),
  )
}
