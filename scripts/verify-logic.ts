/**
 * Headless verification of the pure logic modules (indicators + paper trading).
 * Bundled with esbuild and executed by Node: `npm run verify:logic`.
 */
import assert from 'node:assert/strict'
import { ema, rsi, sma, toLineData } from '../src/lib/indicators'
import {
  accountEquity,
  closePosition,
  createAccount,
  FEE_RATE,
  liquidationPrice,
  liquidateIfNeeded,
  openPosition,
  realizedPnl,
  TradeError,
  unrealizedPnl,
  type Account,
} from '../src/lib/paperTrading'

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok  ${name}`)
}

console.log('indicators')

test('sma warms up with nulls', () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4])
})

test('ema seeds with SMA and applies smoothing', () => {
  assert.deepEqual(ema([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4])
  const values = ema([1, 2, 3, 4, 5, 6], 3)
  assert.equal(values[2], 2)
  assert.equal(values[5], 5)
})

test('ema rejects too-short series', () => {
  assert.deepEqual(ema([1, 2], 5), [null, null])
})

test('rsi is 100 for a monotonic rise', () => {
  const closes = Array.from({ length: 20 }, (_, i) => 100 + i)
  const values = rsi(closes, 14)
  assert.equal(values[13], null)
  assert.equal(values[14], 100)
})

test('rsi stays within 0..100 on mixed data', () => {
  const closes = [10, 11, 10.5, 12, 11.2, 13, 12.4, 14, 13.1, 15, 14.2, 16, 15.4, 17, 16.2, 18, 17.5]
  const values = rsi(closes, 14).filter((v): v is number => v != null)
  assert.ok(values.length > 0)
  for (const v of values) assert.ok(v >= 0 && v <= 100, `rsi out of range: ${v}`)
})

test('toLineData drops warm-up nulls and keeps alignment', () => {
  const data = toLineData([100, 200, 300, 400], [null, 5, 6, null])
  assert.deepEqual(data, [
    { time: 200, value: 5 },
    { time: 300, value: 6 },
  ])
})

console.log('paper trading')

const PX = 100

function opened(overrides: Partial<Parameters<typeof openPosition>[1]> = {}): Account {
  const res = openPosition(createAccount(), {
    symbol: 'BTCUSDT',
    side: 'long',
    size: 1000,
    unit: 'usdt',
    leverage: 10,
    price: PX,
    ...overrides,
  })
  return res.account
}

test('starts at 10,000 USDT', () => {
  const a = createAccount()
  assert.equal(a.cash, 10000)
  assert.equal(a.positions.length, 0)
})

test('open long deducts margin + fee and sizes the position', () => {
  const a = opened()
  assert.equal(a.positions.length, 1)
  const p = a.positions[0]
  assert.equal(p.qty, 10)
  assert.equal(p.margin, 100)
  assert.ok(Math.abs(a.cash - (10000 - 100 - 1000 * FEE_RATE)) < 1e-9)
  assert.equal(unrealizedPnl(p, 110), 100)
  assert.equal(unrealizedPnl(p, 90), -100)
})

test('equity reflects unrealized pnl', () => {
  const a = opened()
  const eq = accountEquity(a, { BTCUSDT: 110 })
  // 9899.6 cash + 100 margin + 100 pnl
  assert.ok(Math.abs(eq - 10099.6) < 1e-9)
})

test('close long realizes net pnl and records history', () => {
  const a = opened()
  const res = closePosition(a, a.positions[0].id, 110, 1_700_000_000_000)
  const p = a.positions[0]
  const net = 100 - p.qty * 110 * FEE_RATE - p.openFee
  assert.ok(Math.abs(res.trade.pnl - 100) < 1e-9)
  assert.ok(Math.abs(realizedPnl(res.account) - net) < 1e-9)
  assert.equal(res.account.positions.length, 0)
  assert.equal(res.account.history.length, 1)
  assert.ok(Math.abs(res.account.cash - (10000 + net)) < 1e-9)
})

test('short profits when price falls', () => {
  const a = opened({ side: 'short' })
  const p = a.positions[0]
  assert.equal(unrealizedPnl(p, 90), 100)
  assert.ok(liquidationPrice(p) > p.entry)
})

test('rejects size over available balance', () => {
  assert.throws(() => opened({ size: 200_000 }), TradeError)
})

test('rejects leverage outside 1..20', () => {
  assert.throws(() => opened({ leverage: 0 }), TradeError)
  assert.throws(() => opened({ leverage: 21 }), TradeError)
})

test('qty unit computes notional from price', () => {
  const a = opened({ size: 2, unit: 'qty' })
  const p = a.positions[0]
  assert.equal(p.qty, 2)
  assert.equal(p.margin, 20)
})

test('liquidation closes a 20x long after a ~5.5% drop', () => {
  const a = opened({ leverage: 20, size: 1000 })
  const liq = liquidationPrice(a.positions[0])
  const res = liquidateIfNeeded(a, { BTCUSDT: liq * 0.98 })
  assert.equal(res.liquidated.length, 1)
  assert.equal(res.account.positions.length, 0)
  assert.ok(res.account.cash <= 10000)
})

test('closing a missing position throws', () => {
  assert.throws(() => closePosition(createAccount(), 'nope', 100), TradeError)
})

console.log(`\n${passed} checks passed`)
