import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ColorType,
  CrosshairMode,
  createChart,
  LineStyle,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type LogicalRange,
  type UTCTimestamp,
} from 'lightweight-charts'
import { fetchKlines, fetchTicker, getCachedCandles } from '../lib/binance'
import { ema, rsi, toLineData } from '../lib/indicators'
import { baseAsset, fmtPct, fmtPrice } from '../lib/format'
import type { Candle, PaneState } from '../lib/types'
import { klineStream, miniTickerStream, prices, streams, useStreamStatus, type KlineEvent, type MiniTickerEvent } from '../lib/ws'
import TimeframeSelector from './TimeframeSelector'
import { AlertIcon, ChevronDownIcon, CloseIcon, LayersIcon, MaximizeIcon, MinimizeIcon, RefreshIcon, SlidersIcon } from './Icons'

interface Props {
  pane: PaneState
  tv: boolean
  onChange: (patch: Partial<PaneState>) => void
  onOpenSymbols: () => void
  onToggleMax: () => void
  onClose: () => void
  canClose: boolean
}

const UP = '#2ebd85'
const DOWN = '#f6465d'

export default function ChartPane({ pane, tv, onChange, onOpenSymbols, onToggleMax, onClose, canClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartHostRef = useRef<HTMLDivElement>(null)
  const rsiHostRef = useRef<HTMLDivElement>(null)
  const legendRef = useRef<HTMLDivElement>(null)

  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const ema20Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const ema50Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const rsiChartRef = useRef<IChartApi | null>(null)
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)

  const [candles, setCandles] = useState<Candle[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [stale, setStale] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [retryKey, setRetryKey] = useState(0)
  const [changePct, setChangePct] = useState<number | null>(null)
  const [chartVersion, setChartVersion] = useState(0)
  const [indicatorsOpen, setIndicatorsOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  const fitPending = useRef(true)
  const streamStatus = useStreamStatus()

  const last = candles.length > 0 ? candles[candles.length - 1] : null
  const price = last?.close ?? null
  const up = (changePct ?? 0) >= 0

  /* ------------------------------- chart ------------------------------- */
  useEffect(() => {
    const host = chartHostRef.current
    if (!host) return
    let chart: IChartApi
    try {
      chart = createChart(host, {
        autoSize: true,
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: '#7f8b9e',
          fontSize: tv ? 13 : 11,
          fontFamily: 'inherit',
          attributionLogo: false,
        },
        localization: { priceFormatter: (p: number) => fmtPrice(p) },
        grid: {
          vertLines: { color: 'rgba(255,255,255,0.035)' },
          horzLines: { color: 'rgba(255,255,255,0.045)' },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: 'rgba(150,170,200,0.35)', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#1b2230' },
          horzLine: { color: 'rgba(150,170,200,0.35)', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#1b2230' },
        },
        rightPriceScale: {
          borderVisible: false,
          scaleMargins: { top: 0.06, bottom: 0.26 },
        },
        timeScale: {
          borderVisible: false,
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 4,
          barSpacing: 6,
          minBarSpacing: 1.2,
        },
        handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
        handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      })
    } catch {
      return
    }
    chartRef.current = chart

    const candleSeries = chart.addCandlestickSeries({
      upColor: UP,
      downColor: DOWN,
      borderVisible: false,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceLineVisible: true,
      priceLineColor: 'rgba(91,140,255,0.85)',
      priceLineWidth: 1,
      priceLineStyle: LineStyle.Dashed,
      lastValueVisible: true,
    })
    candleRef.current = candleSeries

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      priceLineVisible: false,
      lastValueVisible: false,
    })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, visible: false })
    volumeRef.current = volumeSeries

    const e20 = chart.addLineSeries({
      color: '#f2b544',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
    const e50 = chart.addLineSeries({
      color: '#8b7cff',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
    ema20Ref.current = e20
    ema50Ref.current = e50

    chart.subscribeCrosshairMove((param) => {
      const legend = legendRef.current
      if (!legend) return
      if (!param.time || !param.point) {
        legend.classList.add('legend-dim')
        return
      }
      const d = param.seriesData.get(candleSeries) as CandlestickData | undefined
      if (!d) {
        legend.classList.add('legend-dim')
        return
      }
      legend.classList.remove('legend-dim')
      const dir = d.close >= d.open ? 'up' : 'down'
      legend.innerHTML =
        `<span class="lg-item">O <b class="${dir}">${fmtPrice(d.open)}</b></span>` +
        `<span class="lg-item">H <b class="${dir}">${fmtPrice(d.high)}</b></span>` +
        `<span class="lg-item">L <b class="${dir}">${fmtPrice(d.low)}</b></span>` +
        `<span class="lg-item">C <b class="${dir}">${fmtPrice(d.close)}</b></span>`
    })

    setChartVersion((v) => v + 1)

    return () => {
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      volumeRef.current = null
      ema20Ref.current = null
      ema50Ref.current = null
    }
  }, [tv])

  /* ----------------------------- fetch data ---------------------------- */
  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setStale(false)
    setErrorMsg('')
    fitPending.current = true
    setChangePct(null)

    fetchKlines(pane.symbol, pane.timeframe, 500)
      .then((rows) => {
        if (cancelled) return
        setCandles(rows)
        setStatus('ready')
        const lastClose = rows[rows.length - 1]?.close
        if (lastClose) prices.set(pane.symbol, lastClose)
      })
      .catch(() => {
        if (cancelled) return
        const cached = getCachedCandles(pane.symbol, pane.timeframe)
        if (cached && cached.length > 0) {
          setCandles(cached)
          setStale(true)
          setStatus('ready')
        } else {
          setStatus('error')
          setErrorMsg('No se pudieron cargar las velas. Revisa tu conexión.')
        }
      })

    fetchTicker(pane.symbol)
      .then((t) => {
        if (cancelled) return
        setChangePct(t.changePct)
        prices.set(pane.symbol, t.last)
      })
      .catch(() => {
        /* change is optional */
      })

    return () => {
      cancelled = true
    }
  }, [pane.symbol, pane.timeframe, retryKey])

  /* --------------------------- series data ----------------------------- */
  useEffect(() => {
    const candleSeries = candleRef.current
    if (!candleSeries) return
    if (candles.length === 0) {
      candleSeries.setData([])
      volumeRef.current?.setData([])
      ema20Ref.current?.setData([])
      ema50Ref.current?.setData([])
      return
    }
    const times = candles.map((c) => c.time)
    candleSeries.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    )
    volumeRef.current?.setData(
      pane.volume
        ? candles.map((c) => ({
            time: c.time as UTCTimestamp,
            value: c.volume,
            color: c.close >= c.open ? 'rgba(46,189,133,0.32)' : 'rgba(246,70,93,0.32)',
          }))
        : [],
    )
    if (pane.ema) {
      const closes = candles.map((c) => c.close)
      ema20Ref.current?.setData(toLineData(times, ema(closes, 20)) as { time: UTCTimestamp; value: number }[])
      ema50Ref.current?.setData(toLineData(times, ema(closes, 50)) as { time: UTCTimestamp; value: number }[])
    } else {
      ema20Ref.current?.setData([])
      ema50Ref.current?.setData([])
    }
    if (fitPending.current) {
      fitPending.current = false
      chartRef.current?.timeScale().fitContent()
    }
  }, [candles, pane.ema, pane.volume, chartVersion])

  /* -------------------------------- rsi -------------------------------- */
  useEffect(() => {
    if (!pane.rsi) return
    const host = rsiHostRef.current
    if (!host) return
    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#69748a',
        fontSize: tv ? 12 : 10,
        fontFamily: 'inherit',
        attributionLogo: false,
      },
      localization: { priceFormatter: (p: number) => p.toFixed(0) },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.03)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(150,170,200,0.3)', style: LineStyle.Dashed, labelBackgroundColor: '#1b2230' },
        horzLine: { color: 'rgba(150,170,200,0.3)', style: LineStyle.Dashed, labelBackgroundColor: '#1b2230' },
      },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 4, barSpacing: 6 },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    })
    const series = chart.addLineSeries({
      color: '#8b7cff',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerRadius: 2,
    })
    series.createPriceLine({ price: 70, color: 'rgba(246,70,93,0.35)', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' })
    series.createPriceLine({ price: 30, color: 'rgba(46,189,133,0.35)', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' })
    rsiChartRef.current = chart
    rsiSeriesRef.current = series

    const main = chartRef.current
    let guard = false
    const syncFromMain = (range: LogicalRange | null) => {
      if (guard || !range) return
      guard = true
      chart.timeScale().setVisibleLogicalRange(range)
      guard = false
    }
    const syncFromRsi = (range: LogicalRange | null) => {
      if (guard || !range) return
      guard = true
      main?.timeScale().setVisibleLogicalRange(range)
      guard = false
    }
    main?.timeScale().subscribeVisibleLogicalRangeChange(syncFromMain)
    chart.timeScale().subscribeVisibleLogicalRangeChange(syncFromRsi)

    return () => {
      main?.timeScale().unsubscribeVisibleLogicalRangeChange(syncFromMain)
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(syncFromRsi)
      chart.remove()
      rsiChartRef.current = null
      rsiSeriesRef.current = null
    }
  }, [pane.rsi, tv])

  useEffect(() => {
    const series = rsiSeriesRef.current
    if (!series) return
    if (candles.length === 0) {
      series.setData([])
      return
    }
    const closes = candles.map((c) => c.close)
    series.setData(toLineData(candles.map((c) => c.time), rsi(closes, 14)) as { time: UTCTimestamp; value: number }[])
    chartRef.current?.timeScale().fitContent()
  }, [candles, pane.rsi])

  /* ------------------------------ live ws ------------------------------ */
  useEffect(() => {
    const unsub = streams.subscribe(klineStream(pane.symbol, pane.timeframe), (raw) => {
      const ev = raw as KlineEvent
      if (!ev?.k) return
      const k = ev.k
      const next: Candle = {
        time: Math.floor(k.t / 1000),
        open: Number(k.o),
        high: Number(k.h),
        low: Number(k.l),
        close: Number(k.c),
        volume: Number(k.v),
      }
      if (!Number.isFinite(next.close)) return
      prices.set(pane.symbol, next.close)
      setCandles((prev) => {
        if (prev.length === 0) return prev
        const lastCandle = prev[prev.length - 1]
        if (next.time === lastCandle.time) {
          const copy = prev.slice()
          copy[copy.length - 1] = next
          return copy
        }
        if (next.time > lastCandle.time) {
          const copy = prev.slice(-599)
          copy.push(next)
          return copy
        }
        return prev
      })
    })
    return unsub
  }, [pane.symbol, pane.timeframe])

  useEffect(() => {
    const unsub = streams.subscribe(miniTickerStream(pane.symbol), (raw) => {
      const ev = raw as MiniTickerEvent
      const close = Number(ev?.c)
      const open = Number(ev?.o)
      if (!Number.isFinite(close)) return
      prices.set(pane.symbol, close)
      if (Number.isFinite(open) && open > 0) setChangePct(((close - open) / open) * 100)
    })
    return unsub
  }, [pane.symbol])

  /* --------------------- REST fallback while offline -------------------- */
  useEffect(() => {
    if (streamStatus !== 'offline' && streamStatus !== 'reconnecting') return
    const poll = async () => {
      try {
        const rows = await fetchKlines(pane.symbol, pane.timeframe, 300)
        if (rows.length > 0) {
          fitPending.current = false
          setCandles(rows)
          setStatus('ready')
        }
      } catch {
        /* keep showing last candles */
      }
    }
    const timer = window.setInterval(poll, 20_000)
    return () => window.clearInterval(timer)
  }, [streamStatus, pane.symbol, pane.timeframe])

  useEffect(() => {
    if (!indicatorsOpen) return
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (target && popoverRef.current?.contains(target)) return
      setIndicatorsOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [indicatorsOpen])

  const toggleIndicator = useCallback(
    (key: 'ema' | 'rsi' | 'volume') => {
      onChange({ [key]: !pane[key] } as Partial<PaneState>)
    },
    [onChange, pane],
  )

  const retry = useCallback(() => setRetryKey((k) => k + 1), [])

  return (
    <section className={`pane${pane.maximized ? ' maximized' : ''}`} aria-label={`Gráfico ${pane.symbol}`}>
      <header className="pane-head">
        <button type="button" className="symbol-btn" onClick={onOpenSymbols} aria-label="Cambiar símbolo">
          <span className="sym-base">{baseAsset(pane.symbol)}</span>
          <span className="sym-quote">USDT</span>
          <ChevronDownIcon size={14} />
        </button>

        <div className="pane-price">
          <span className={`price mono${up ? ' up' : ' down'}`}>{price != null ? fmtPrice(price) : '—'}</span>
          <span className={`change mono${up ? ' up' : ' down'}`}>
            {changePct == null ? '—' : fmtPct(changePct)}
          </span>
        </div>

        <div className="pane-actions">
          <div className="popover-wrap" ref={popoverRef}>
            <button
              type="button"
              className={`icon-btn${indicatorsOpen ? ' active' : ''}`}
              aria-label="Indicadores"
              aria-expanded={indicatorsOpen}
              onClick={() => setIndicatorsOpen((v) => !v)}
            >
              <SlidersIcon size={17} />
            </button>
            {indicatorsOpen && (
              <div className="popover" role="menu">
                <p className="popover-title">Indicadores</p>
                <label className="check-row">
                  <input type="checkbox" checked={pane.ema} onChange={() => toggleIndicator('ema')} />
                  <span className="legend-swatch" style={{ background: '#f2b544' }} />
                  EMA 20 / 50
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={pane.rsi} onChange={() => toggleIndicator('rsi')} />
                  <span className="legend-swatch" style={{ background: '#8b7cff' }} />
                  RSI 14
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={pane.volume} onChange={() => toggleIndicator('volume')} />
                  <span className="legend-swatch" style={{ background: 'rgba(255,255,255,.35)' }} />
                  Volumen
                </label>
              </div>
            )}
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label={pane.maximized ? 'Restaurar panel' : 'Maximizar panel'}
            onClick={onToggleMax}
          >
            {pane.maximized ? <MinimizeIcon size={16} /> : <MaximizeIcon size={16} />}
          </button>
          {canClose && (
            <button type="button" className="icon-btn danger" aria-label="Cerrar panel" onClick={onClose}>
              <CloseIcon size={16} />
            </button>
          )}
        </div>
      </header>

      <div className="pane-sub">
        <TimeframeSelector value={pane.timeframe} onChange={(tf) => onChange({ timeframe: tf })} compact />
        <span className="pane-tags">
          {pane.ema && <span className="tag">EMA</span>}
          {pane.rsi && <span className="tag">RSI</span>}
        </span>
      </div>

      <div className={`chart-stack${pane.rsi ? ' with-rsi' : ''}`} ref={containerRef}>
        <div className="chart-main">
          <div ref={chartHostRef} className="chart-host" />
          <div className="chart-legend legend-dim" ref={legendRef}>
            <span className="legend-hint">
              <LayersIcon size={13} /> {pane.symbol} · {pane.timeframe}
            </span>
          </div>
          {status === 'loading' && (
            <div className="chart-overlay">
              <div className="skeleton-bars" aria-hidden="true">
                <span /><span /><span /><span /><span /><span /><span />
              </div>
              <p className="overlay-text">Cargando velas…</p>
            </div>
          )}
          {status === 'error' && (
            <div className="chart-overlay error">
              <AlertIcon size={26} />
              <p className="overlay-text">{errorMsg}</p>
              <button type="button" className="btn ghost small" onClick={retry}>
                <RefreshIcon size={15} /> Reintentar
              </button>
            </div>
          )}
          {stale && status === 'ready' && <span className="stale-chip">datos en caché</span>}
        </div>
        {pane.rsi && <div className="chart-rsi" ref={rsiHostRef} aria-label="RSI 14" />}
      </div>
    </section>
  )
}
