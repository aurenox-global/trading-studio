# Trading Studio

Aplicación web de gráficos de velas en tiempo real con una **cuenta de trading demo** (paper trading). Sin backend, sin claves API, sin registro y sin dinero real.

**Demo en vivo:** <https://aurenox-global.github.io/trading-studio/>

## Características

- **Diseño responsive real**
  - Móvil (< 900 px): una barra de pestañas inferior con tus símbolos; un gráfico a la vez.
  - Escritorio: hasta 4 paneles simultáneos con disposiciones `1×1`, `2×1`, `1×2`, `3 paneles` (uno grande + dos pequeños) y `2×2`. La elección se guarda.
  - Modo TV automático a partir de 1900 px de ancho: tipografía escalada con `clamp()`, alto contraste y controles grandes. También se puede activar a mano con el botón de TV.
- **Paneles independientes**: cada uno tiene su propio selector de símbolo (buscador con mercado y variación 24 h) y su propia temporalidad (`1m`, `5m`, `15m`, `1h`, `4h`, `1d`).
- **Gráficos** con [lightweight-charts](https://github.com/tradingview/lightweight-charts) (Apache-2.0): velas, volumen, crosshair, línea de precio actual, zoom/arrastre y redimensionado por panel.
- **Indicadores calculados en el cliente** y activables por panel: EMA 20/50, RSI 14 y volumen.
- **Cuenta demo**: 10.000 USDT iniciales, long/short a mercado, tamaño en USDT o cantidad, apalancamiento 1x–20x, comisión 0,04 %, PnL no realizado en vivo, precio de liquidación, cierre de posiciones, historial y reinicio. Todo persiste en `localStorage`.
- **Robustez**: skeletons de carga, reintento con velas en caché local, reconexión de WebSocket con backoff exponencial, cleanup de suscripciones al cambiar paneles.
- **Privacidad**: sin analíticas, sin cookies de terceros, sin fuentes externas. Iconos SVG propios.

## Uso

1. Abre la demo en el móvil o el ordenador.
2. Pulsa el nombre del símbolo (p. ej. `BTC/USDT`) en la cabecera de un panel para buscar otro mercado.
3. Cambia la temporalidad con las píldoras `1m … 1d`.
4. Abre el menú de indicadores (icono de controles) y activa EMA, RSI o volumen.
5. En escritorio elige la disposición con los iconos de la cabecera. En móvil usa las pestañas inferiores y el botón de rayo para abrir el panel de operar.
6. Introduce un tamaño, elige Long o Short y pulsa **Abrir Long / Abrir Short**. La posición aparece en «Cuenta demo» con PnL en vivo; ciérrala con **Cerrar**.
7. **Reiniciar** devuelve la cuenta a 10.000 USDT (pide confirmación con un segundo toque).

> La cuenta demo vive solo en tu navegador. Borrar los datos del sitio o usar otro dispositivo empieza una cuenta nueva.

## Desarrollo local

Requisitos: Node.js 20+ y npm.

```bash
npm ci
npm run dev        # http://localhost:5173/  (base raíz en desarrollo)
npm run build      # compilación TypeScript estricta + build de producción
npm run preview    # http://localhost:4173/trading-studio/
```

En producción la base de Vite es `/trading-studio/` (GitHub Pages). En desarrollo se sirve en la raíz para comodidad.

### Verificación

```bash
npm run verify:logic   # 16 aserciones de indicadores y motor de paper trading
npm run build          # cero errores de TypeScript
```

Prueba de humo en navegador real (headless) mediante Chrome DevTools Protocol:

```bash
# Terminal 1
npm run preview

# Terminal 2: navegador Chromium con depuración remota
"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
  --headless=new --remote-debugging-port=9222 \
  --user-data-dir=/tmp/ts-brave --no-first-run about:blank &

# Terminal 3
npm run verify:e2e
```

El script comprueba: carga inicial, cambio de disposición 1 → 4 paneles, cambio de símbolo, apertura y cierre de una orden demo, persistencia tras recargar, menú de indicadores, modo TV a 2560 px, pestañas móviles, hoja de operar y ausencia de desbordamiento horizontal a 320 px. Falla si hay errores de consola o respuestas HTTP ≥ 400. Guarda capturas en `/tmp`.

## Datos de mercado

Sin claves y sin servicios de pago. Cadena de proveedores:

| Prioridad | Proveedor | Uso |
| --- | --- | --- |
| 1 | **Binance** | `api.binance.com` para velas/tickers y `wss://stream.binance.com:9443` para velas y mini-ticker en vivo. |
| 2 | **Pionex** | Respaldo documentado (`api.pionex.com/api/v1/market/...`). |
| 3 | **OKX** | Último recurso con CORS habilitado (`www.okx.com/api/v5/...`). |

**Nota importante sobre Pionex:** su API pública no envía cabeceras `Access-Control-Allow-Origin`, por lo que un navegador no puede leerla desde otro origen. El proveedor está implementado y se usa cuando el entorno lo permite (p. ej. sin restricciones CORS), pero en la web estática el respaldo efectivo es OKX. La interfaz muestra «Fuente: … (respaldo)» cuando cambia de proveedor.

Binance puede estar bloqueado en algunas regiones; en ese caso la app cae a los respaldos y, si todos fallan, muestra las últimas velas guardadas en caché con un botón de reintento. No se usa ninguna API de pago ni se envían credenciales.

## Estructura

```
src/
  components/
    ChartPane.tsx        gráfico por panel, WS, indicadores, estados de error
    LayoutGrid.tsx       rejilla 1/2/3/4 paneles y maximizado
    SymbolPicker.tsx     buscador de mercados + variación 24 h
    TimeframeSelector.tsx
    OrderPanel.tsx       long/short, tamaño, apalancamiento
    PositionsPanel.tsx   equity, posiciones, historial, reset
    TabsBar.tsx          pestañas móviles + acceso a operar
  lib/
    binance.ts           proveedores REST (Binance → Pionex → OKX) y caché
    ws.ts                hub WebSocket, backoff, precios compartidos
    indicators.ts        EMA, RSI, SMA
    paperTrading.ts      motor de cuenta demo + persistencia
    format.ts            formato numérico/fechas
    types.ts             tipos y constantes
scripts/
  verify-logic.ts        aserciones del cálculo puro
  headless-check.mjs     prueba E2E vía CDP
```

## Limitaciones conocidas

- **No hay órdenes reales**: es una simulación local; los precios son de mercado pero las ejecuciones son instantáneas al precio de marca, sin libro de órdenes ni deslizamiento.
- Las liquidaciones son aproximadas (se disparan al perder ~98 % del margen) y no incluyen funding.
- El historial se guarda en `localStorage` (máx. 200 operaciones) y es por navegador.
- Depende de APIs públicas de terceros: si Binance/Pionex/OKX cambian o bloquean sus endpoints, la app muestra el estado de error correspondiente.
- En pantallas táctiles muy estrechas (< 320 px) no se ha probado; el diseño parte de 320 px.

## Licencia

MIT — consulta [LICENSE](./LICENSE).
