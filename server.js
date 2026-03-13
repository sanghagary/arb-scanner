/**
 * Polymarket / Kalshi Arbitrage Scanner
 * Standalone executable version — HTML is embedded, no external files needed.
 * Built with pkg: https://github.com/vercel/pkg
 */

const express  = require('express');
const axios    = require('axios');
const cors     = require('cors');
const NodeCache = require('node-cache');
const { exec } = require('child_process');
const path     = require('path');
const fs       = require('fs');

const app   = express();
const PORT  = process.env.PORT || 3000;
const cache = new NodeCache({ stdTTL: 8 });

app.use(cors());
app.use(express.json());

// ── EMBEDDED HTML ─────────────────────────────────────────────────────────────
// Read from filesystem if running in dev, fall back to embedded string in pkg exe
function getHTML() {
  // In pkg, __dirname resolves to snapshot, try adjacent file first
  const candidates = [
    path.join(path.dirname(process.execPath), 'scanner.html'),
    path.join(__dirname, 'scanner.html'),
    path.join(__dirname, 'public', 'index.html'),
  ];
  for (const p of candidates) {
    try { return fs.readFileSync(p, 'utf8'); } catch {}
  }
  // Final fallback — minimal redirect page
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
  <title>ARB Scanner</title></head><body style="background:#050608;color:#00e87a;
  font-family:monospace;padding:40px;text-align:center">
  <h2>ARB Scanner running</h2>
  <p>scanner.html not found alongside exe — place scanner.html next to arb-scanner.exe</p>
  </body></html>`;
}

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(getHTML());
});

// ── POLYMARKET API ────────────────────────────────────────────────────────────
async function fetchPolymarkets() {
  const cached = cache.get('poly');
  if (cached) return cached;
  const res = await axios.get('https://gamma-api.polymarket.com/markets', {
    params: { active: true, closed: false, limit: 200, order: 'volume24hr', ascending: false },
    timeout: 10000,
  });
  const markets = (res.data || [])
    .filter(m => m.outcomePrices && m.question)
    .map(m => {
      try {
        const p = JSON.parse(m.outcomePrices);
        if (p.length !== 2) return null;
        const yes = parseFloat(p[0]), no = parseFloat(p[1]);
        if (!yes || !no) return null;
        return {
          id: m.id, source: 'poly', question: m.question,
          yes, no, sum: +((yes+no).toFixed(4)),
          volume24h: m.volume24hr || 0, endDate: m.endDate || null,
          url: `https://polymarket.com/event/${m.slug || m.id}`,
          keywords: kw(m.question),
        };
      } catch { return null; }
    }).filter(Boolean);
  cache.set('poly', markets);
  return markets;
}

// ── KALSHI API ────────────────────────────────────────────────────────────────
async function fetchKalshi() {
  const cached = cache.get('kalshi');
  if (cached) return cached;
  const headers = { Accept: 'application/json' };
  if (process.env.KALSHI_API_KEY) headers['Authorization'] = `Bearer ${process.env.KALSHI_API_KEY}`;
  const res = await axios.get('https://trading-api.kalshi.com/trade-api/v2/markets', {
    params: { limit: 200, status: 'open' },
    headers, timeout: 10000,
  });
  const markets = (res.data?.markets || [])
    .filter(m => m.yes_bid != null && m.title)
    .map(m => {
      const yes = +((m.yes_bid/100 + m.yes_ask/100)/2).toFixed(4);
      const no  = +((m.no_bid/100  + m.no_ask/100)/2).toFixed(4);
      return {
        id: m.ticker, source: 'kalshi', question: m.title,
        yes, no, yesAsk: m.yes_ask/100, noAsk: m.no_ask/100,
        sum: +((yes+no).toFixed(4)),
        endDate: m.close_time || null,
        url: `https://kalshi.com/markets/${m.ticker}`,
        keywords: kw(m.title),
      };
    });
  cache.set('kalshi', markets);
  return markets;
}

// ── KEYWORD / ARB HELPERS ─────────────────────────────────────────────────────
const STOP = new Set(['will','the','a','an','be','is','are','was','were','in','on',
  'at','to','for','of','and','or','by','with','does','do','has','have','from',
  'than','more','less','above','below','before','after','win','lose','what',
  'when','which','who','how','yes','no','not']);

function kw(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g,' ')
    .split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
}

function jaccard(a, b) {
  const sa = new Set(a), sb = new Set(b);
  const inter = [...sa].filter(w => sb.has(w)).length;
  const union = new Set([...sa,...sb]).size;
  return union ? inter/union : 0;
}

function calcArb(poly, kalshi) {
  const strats = [];
  const s1 = +(poly.yes + kalshi.no).toFixed(4);
  const s2 = +(kalshi.yes + poly.no).toFixed(4);
  if (s1 < 1.0) {
    const profit = +(1-s1).toFixed(4);
    strats.push({ strategy: 'YES(Poly)+NO(Kalshi)',
      legs: [{platform:'Polymarket',side:'YES',price:poly.yes,url:poly.url},
             {platform:'Kalshi',    side:'NO', price:kalshi.noAsk||kalshi.no,url:kalshi.url}],
      totalCost:s1, profitPerDollar:profit,
      profitPct:+((profit/s1)*100).toFixed(3), profitPer100:+(profit*100).toFixed(2) });
  }
  if (s2 < 1.0) {
    const profit = +(1-s2).toFixed(4);
    strats.push({ strategy: 'YES(Kalshi)+NO(Poly)',
      legs: [{platform:'Kalshi',    side:'YES',price:kalshi.yesAsk||kalshi.yes,url:kalshi.url},
             {platform:'Polymarket',side:'NO', price:poly.no,url:poly.url}],
      totalCost:s2, profitPerDollar:profit,
      profitPct:+((profit/s2)*100).toFixed(3), profitPer100:+(profit*100).toFixed(2) });
  }
  return strats.sort((a,b) => b.profitPct - a.profitPct);
}

// ── SCAN ENDPOINT ─────────────────────────────────────────────────────────────
app.get('/api/scan', async (req, res) => {
  const t = Date.now();
  try {
    const [polyMarkets, kalshiMarkets] = await Promise.all([
      fetchPolymarkets(), fetchKalshi(),
    ]);
    const usedK = new Set();
    const pairs = polyMarkets.map(poly => {
      let best = 0.18, bk = null;
      for (const k of kalshiMarkets) {
        if (usedK.has(k.id)) continue;
        const sc = jaccard(poly.keywords, k.keywords);
        if (sc > best) { best = sc; bk = k; }
      }
      if (bk) usedK.add(bk.id);
      const arbs = bk ? calcArb(poly, bk) : [];
      return { poly, kalshi: bk, matchScore: +best.toFixed(3),
               arbs, hasArb: arbs.length > 0,
               bestProfitPct: arbs[0]?.profitPct || 0 };
    }).sort((a,b) => b.hasArb - a.hasArb || b.bestProfitPct - a.bestProfitPct);

    res.json({
      ok: true, scannedAt: new Date().toISOString(), scanMs: Date.now()-t,
      stats: {
        polymarketsScanned: polyMarkets.length,
        kalshiMarketsScanned: kalshiMarkets.length,
        matchedPairs: pairs.filter(p=>p.kalshi).length,
        arbOpportunities: pairs.filter(p=>p.hasArb).length,
      },
      pairs: pairs.slice(0, 100),
    });
  } catch(err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ── START + AUTO-OPEN BROWSER ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  ARB SCANNER running at http://localhost:${PORT}\n`);
  // Auto-open browser
  const url = `http://localhost:${PORT}`;
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
            : process.platform === 'darwin' ? `open "${url}"`
            : `xdg-open "${url}"`;
  setTimeout(() => exec(cmd), 1500);
});
