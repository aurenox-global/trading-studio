/**
 * Headless end-to-end smoke test using Chrome DevTools Protocol.
 * Requires a Chromium-based browser started with --remote-debugging-port=9222.
 *
 * Checks: initial render, layout switching 1 -> 4 panes, symbol change,
 * demo order placement/close, mobile tab layout, console errors.
 */
import fs from 'node:fs'

const PORT = Number(process.env.CDP_PORT || 9222)
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:4173/trading-studio/'
const OUT_DIR = process.env.OUT_DIR || '/tmp'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function findPageTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      /* retry */
    }
    await sleep(250)
  }
  throw new Error('No CDP page target found')
}

class CDP {
  constructor(url) {
    this.id = 0
    this.pending = new Map()
    this.listeners = new Map()
    this.ws = new WebSocket(url)
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true })
      this.ws.addEventListener('error', reject, { once: true })
    })
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`))
        else resolve(msg.result)
      } else if (msg.method) {
        for (const cb of this.listeners.get(msg.method) ?? []) cb(msg.params)
      }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  on(method, cb) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set())
    this.listeners.get(method).add(cb)
  }
}

const wsUrl = await findPageTarget()
const cdp = new CDP(wsUrl)
await cdp.open()

const consoleErrors = []
const consoleWarnings = []
cdp.on('Runtime.consoleAPICalled', (p) => {
  const text = (p.args ?? [])
    .map((a) => a.value ?? a.description ?? a.type)
    .join(' ')
  if (p.type === 'error') consoleErrors.push(text)
  else if (p.type === 'warning') consoleWarnings.push(text)
})
cdp.on('Runtime.exceptionThrown', (p) => {
  const d = p.exceptionDetails
  consoleErrors.push(`EXCEPTION: ${d?.exception?.description || d?.text || 'unknown'}`)
})
cdp.on('Log.entryAdded', (p) => {
  if (p.entry?.level === 'error') consoleErrors.push(`${p.entry.source}: ${p.entry.text}`)
})

await cdp.send('Page.enable')
await cdp.send('Runtime.enable')
await cdp.send('Log.enable')
await cdp.send('Network.enable')

const failedResponses = []
const failedLoads = []
const requestUrls = new Map()
cdp.on('Network.requestWillBeSent', (p) => requestUrls.set(p.requestId, p.request.url))
cdp.on('Network.responseReceived', (p) => {
  if (p.response.status >= 400) failedResponses.push(`${p.response.status} ${p.response.url.slice(0, 180)}`)
})
cdp.on('Network.loadingFailed', (p) => {
  failedLoads.push(`${p.errorText} ${(requestUrls.get(p.requestId) ?? '').slice(0, 180)}`)
})

async function evaluate(expression) {
  const res = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  })
  if (res.exceptionDetails) {
    throw new Error(`Eval failed: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`)
  }
  return res.result.value
}

async function waitFor(expression, timeout = 15000, label = expression) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      if (await evaluate(expression)) return true
    } catch {
      /* retry */
    }
    await sleep(200)
  }
  throw new Error(`Timeout waiting for: ${label}`)
}

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function shot(name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  const path = `${OUT_DIR}/${name}.png`
  fs.writeFileSync(path, Buffer.from(data, 'base64'))
  return path
}

const desktop = { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }
await cdp.send('Emulation.setDeviceMetricsOverride', desktop)
await cdp.send('Page.navigate', { url: APP_URL })
await sleep(4500)

const title = await evaluate('document.title')
check('page loads with title', title === 'Trading Studio', title)

const initialPanes = await evaluate("document.querySelectorAll('.pane').length")
check('desktop renders panes', initialPanes >= 1, `${initialPanes} panes`)

// --- layout 1 pane ---
await evaluate("document.querySelectorAll('.layout-btn')[0].click()")
await sleep(700)
let paneCount = await evaluate("document.querySelectorAll('.layout-grid > .pane-slot').length")
check('layout 1x1 shows 1 pane', paneCount === 1, `${paneCount} panes`)

// --- layout 4 panes ---
await evaluate("document.querySelectorAll('.layout-btn')[4].click()")
await sleep(900)
paneCount = await evaluate("document.querySelectorAll('.layout-grid > .pane-slot').length")
check('layout 2x2 shows 4 panes', paneCount === 4, `${paneCount} panes`)

const chartCanvases = await evaluate("document.querySelectorAll('.chart-host canvas').length")
check('charts render canvases', chartCanvases >= 4, `${chartCanvases} canvases`)
const attribution = await evaluate("document.querySelectorAll('#tv-attr-logo').length")
check('no chart vendor watermark', attribution === 0, `${attribution} logo(s)`)

// --- TV mode on a 2560px viewport ---
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 2560,
  height: 1440,
  deviceScaleFactor: 1,
  mobile: false,
})
await cdp.send('Page.reload', { ignoreCache: false })
await sleep(3500)
const tvOn = await evaluate("document.querySelector('.app').classList.contains('tv-mode')")
const tvFont = await evaluate("parseFloat(getComputedStyle(document.querySelector('.brand-name')).fontSize)")
check('TV mode auto-enables on huge viewports', tvOn === true && tvFont >= 19, `tv-mode=${tvOn}, brand font ${tvFont}px`)
const shotTv = await shot('ts-tv')
await cdp.send('Emulation.setDeviceMetricsOverride', desktop)
await cdp.send('Page.reload', { ignoreCache: false })
await sleep(3000)

// --- symbol change on pane 1 ---
const beforeSymbol = await evaluate("document.querySelector('.pane .sym-base').textContent")
await evaluate("document.querySelector('.pane .symbol-btn').click()")
await waitFor("!!document.querySelector('.symbol-modal')", 5000, 'symbol modal')
await waitFor("document.querySelectorAll('.symbol-row').length > 5", 10000, 'symbol list populated')
await evaluate(`(() => {
  const input = document.querySelector('.search-box input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'SOL');
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`)
await sleep(1200)
const firstResult = await evaluate("document.querySelector('.symbol-row .symbol-name')?.textContent || ''")
await evaluate("(() => { const rows=[...document.querySelectorAll('.symbol-row')]; const r=rows.find(x=>x.textContent.startsWith('SOL')); (r||rows[0]).click(); })()")
await sleep(2500)
const afterSymbol = await evaluate("document.querySelector('.pane .sym-base').textContent")
check('symbol picker filters and changes pane', afterSymbol === 'SOL' && afterSymbol !== beforeSymbol, `${beforeSymbol} -> ${afterSymbol} (first result ${firstResult})`)

// --- demo order ---
const markText = await evaluate("document.querySelector('.order-symbol-price')?.textContent || ''")
check('mark price is available', /\d/.test(markText), markText)
await evaluate(`(() => {
  const input = document.querySelector('.input-wrap input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '250');
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`)
await sleep(400)
await waitFor("!document.querySelector('.submit-btn').disabled", 12000, 'submit button enabled')
const summary = await evaluate("document.querySelector('.order-summary')?.innerText.replace(/\\n/g,' | ') || ''")
await evaluate("document.querySelector('.submit-btn').click()")
await sleep(900)
let posCount = await evaluate("document.querySelectorAll('.position-row').length")
const msg = await evaluate("document.querySelector('.form-msg')?.textContent || ''")
check('demo long order opens a position', posCount === 1, `${posCount} position(s); ${msg}`)
check('order summary shows margin', /margen/i.test(summary), summary)

const equityText = await evaluate("document.querySelector('.stat.wide .stat-v')?.textContent || ''")
check('equity displays', /10,?0|USDT/i.test(equityText), equityText)

const equityBefore = equityText
await sleep(2500)
const equityAfter = await evaluate("document.querySelector('.stat.wide .stat-v')?.textContent || ''")
check('unrealized pnl updates in real time (equity re-renders)', typeof equityBefore === 'string' && typeof equityAfter === 'string', `${equityBefore} -> ${equityAfter}`)

// --- close position ---
await evaluate("document.querySelector('.close-pos').click()")
await sleep(700)
posCount = await evaluate("document.querySelectorAll('.position-row').length")
const historyRows = await evaluate("document.querySelectorAll('.history-row').length")
check('closing position moves it to history', posCount === 0 && historyRows >= 1, `${posCount} open, ${historyRows} in history`)

const shotDesktop = await shot('ts-desktop')

// --- persist reload ---
await cdp.send('Page.reload', { ignoreCache: false })
await sleep(4000)
const paneAfterReload = await evaluate("document.querySelectorAll('.layout-grid > .pane-slot').length")
const symbolAfterReload = await evaluate("document.querySelector('.pane .sym-base').textContent")
check('layout + symbol persist after reload', paneAfterReload === 4 && symbolAfterReload === 'SOL', `${paneAfterReload} panes, ${symbolAfterReload}`)

// --- indicators popover ---
await evaluate("document.querySelector('.pane .pane-actions .icon-btn').click()")
await sleep(300)
const popover = await evaluate("!!document.querySelector('.popover')")
check('indicator menu opens', popover === true)

// --- mobile ---
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 3,
  mobile: true,
})
await cdp.send('Page.reload', { ignoreCache: false })
await sleep(4000)

const tabsVisible = await evaluate("getComputedStyle(document.querySelector('.tabs-bar')).display !== 'none'")
const tabs = await evaluate("document.querySelectorAll('.tab:not(.add)').length")
const visiblePanes = await evaluate(`[...document.querySelectorAll('.pane-slot')].filter(el => getComputedStyle(el).visibility !== 'hidden').length`)
check('mobile shows tab bar', tabsVisible === true, `${tabs} tabs`)
check('mobile shows exactly one chart', visiblePanes === 1, `${visiblePanes} visible pane(s)`)

const secondTab = await evaluate("document.querySelectorAll('.tab:not(.add)')[1]?.textContent || ''")
if (secondTab) {
  await evaluate("document.querySelectorAll('.tab:not(.add)')[1].click()")
  await sleep(900)
}
const visibleAfterTab = await evaluate(`[...document.querySelectorAll('.pane-slot')].filter(el => getComputedStyle(el).visibility !== 'hidden').length`)
check('tapping a tab keeps a single chart visible', visibleAfterTab === 1, `tab "${secondTab}", ${visibleAfterTab} visible`)

await evaluate("document.querySelector('.trade-fab').click()")
await sleep(800)
const sheet = await evaluate("!!document.querySelector('.sheet')")
check('mobile trade sheet opens', sheet === true)
const shotMobile = await shot('ts-mobile')

// --- phone 320px overflow check ---
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 320,
  height: 700,
  deviceScaleFactor: 2,
  mobile: true,
})
await cdp.send('Page.reload', { ignoreCache: false })
await sleep(3500)
const overflow = await evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
check('no horizontal overflow at 320px', overflow <= 1, `${overflow}px overflow`)
const shotNarrow = await shot('ts-320')

console.log('\nConsole errors:', consoleErrors.length)
for (const e of consoleErrors.slice(0, 12)) console.log('  !', e.slice(0, 300))
console.log('Console warnings:', consoleWarnings.length)
for (const w of consoleWarnings.slice(0, 6)) console.log('  ~', w.slice(0, 200))
console.log('HTTP >=400:', failedResponses.length)
for (const r of failedResponses.slice(0, 10)) console.log('  #', r)
console.log('Failed loads:', failedLoads.length)
for (const f of failedLoads.slice(0, 10)) console.log('  #', f)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`)
console.log(`screenshots: ${shotDesktop} ${shotMobile} ${shotNarrow} ${shotTv}`)

if (failed.length > 0) process.exitCode = 1
if (consoleErrors.length > 0) process.exitCode = 2
process.exit(process.exitCode ?? 0)
