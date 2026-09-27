const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Parser = require('rss-parser');

const app = express();
const parser = new Parser();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const BIQUOTE_BASE_URL = 'https://biquote.io';

app.get('/', (req, res) => {
  const publicIndexPath = path.join(__dirname, 'public', 'index.html');
  const rootIndexPath = path.join(__dirname, 'index.html');

  if (fs.existsSync(publicIndexPath)) {
    res.sendFile(publicIndexPath);
  } else if (fs.existsSync(rootIndexPath)) {
    res.sendFile(rootIndexPath);
  } else {
    res.status(404).send('<h2>ไม่พบไฟล์ index.html!</h2>');
  }
});

function normalizeBiQuoteSymbol(symbol) {
  const raw = String(symbol || 'XAUUSD').trim().toUpperCase();

  const aliases = {
    'OANDA:XAUUSD': 'XAUUSD',
    'XAUUSD': 'XAUUSD',
    'OANDA:EURUSD': 'EURUSD',
    'EURUSD': 'EURUSD',
    'BINANCE:BTCUSDT': 'BTCUSD',
    'BTCUSDT': 'BTCUSD',
    'BTCUSD': 'BTCUSD',
    'TVC:USOIL': 'USOIL',
    'USOIL': 'USOIL',
    'NASDAQ:QQQ': 'QQQ',
    'QQQ': 'QQQ'
  };

  if (aliases[raw]) return aliases[raw];
  if (raw.includes(':')) return raw.split(':').pop();
  return raw;
}

async function fetchBiQuoteTick(symbol) {
  const bqSymbol = normalizeBiQuoteSymbol(symbol);
  const url = `${BIQUOTE_BASE_URL}/api/${encodeURIComponent(bqSymbol)}?allowStale=false`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache' },
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`BiQuote ${response.status}: ${body || response.statusText}`);
    }

    const tick = await response.json();
    const mid = Number(tick.mid);

    if (!Number.isFinite(mid) || mid <= 0) {
      throw new Error(`BiQuote returned invalid mid for ${bqSymbol}`);
    }

    return {
      symbol: bqSymbol,
      bid: Number(tick.bid) || 0,
      ask: Number(tick.ask) || 0,
      mid: mid,
      spread: Number(tick.spread) || 0,
      direction: tick.direction || 'FLAT',
      dayDiffPercent: Number(tick.dayDiffPercent) || 0,
      timestamp: tick.timestamp || null,
      source: tick.source || 'BiQuote',
      marketState: tick.marketState || 'unknown',
      stale: Boolean(tick.stale),
      quoteAgeSeconds: Number(tick.quoteAgeSeconds) || 0,
      lastQuoteAt: tick.lastQuoteAt || null
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchBiQuoteOHLC(symbol, interval) {
  const bqSymbol = normalizeBiQuoteSymbol(symbol);
  const allowedIntervals = new Set(['1m', '5m', '15m', '30m', '1h', '4h', '1d']);
  const safeInterval = allowedIntervals.has(interval) ? interval : '1m';

  const url = `${BIQUOTE_BASE_URL}/api/${encodeURIComponent(bqSymbol)}/ohlc?interval=${safeInterval}&limit=120`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache' },
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`BiQuote OHLC ${response.status}`);
    const data = await response.json();
    return Array.isArray(data.bars) ? data.bars : [];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchDailyNewsAnalysis(symbol) {
  const rssFeeds = [
    { name: 'MarketWatch Top Stories', url: 'http://feeds.marketwatch.com/marketwatch/topstories' },
    { name: 'FXStreet News', url: 'https://www.fxstreet.com/rss/news' }
  ];

  let newsItems = [];
  let hasHighImpactNews = false;

  for (const feedConfig of rssFeeds) {
    try {
      const feed = await parser.parseURL(feedConfig.url);
      const processed = feed.items.slice(0, 3).map(item => {
        const text = (item.title + ' ' + (item.contentSnippet || '')).toLowerCase();
        if (text.includes('fed') || text.includes('cpi') || text.includes('nfp') || text.includes('fomc') || text.includes('rate')) {
          hasHighImpactNews = true;
        }
        return {
          source: feedConfig.name,
          title: item.title,
          reason: item.contentSnippet ? item.contentSnippet.substring(0, 150) + '...' : 'อ่านต่อจากแหล่งข่าวต้นทาง',
          link: item.link || '#'
        };
      });
      newsItems = newsItems.concat(processed);
    } catch (err) {
      console.log(`Feed fetch error: ${feedConfig.name}`);
    }
  }

  return { hasHighImpactNews, newsList: newsItems };
}

// =====================================================
// RECALCULATE REALISTIC BUY / SELL TRADING SETUP
// =====================================================
function calculatePunportSetup(symbol, tf, realPrice, hasNews) {
  const currentPrice = Number.isFinite(Number(realPrice)) && Number(realPrice) > 0 ? Number(realPrice) : 0;
  if (!currentPrice) throw new Error('Invalid market price');

  // คำนวณช่วงการผันผวน (Volatility Ratio) อิงตามสัญลักษณ์
  const isForex = symbol.includes('EUR') || symbol.includes('USD') && !symbol.includes('XAU') && !symbol.includes('BTC');
  const baseRange = currentPrice * (isForex ? 0.0015 : 0.0035);

  // แนวรับ-แนวต้านที่สอดคล้องกับโครงสร้างราคาจริง
  const res1 = (currentPrice + baseRange * 0.6).toFixed(isForex ? 5 : 2);
  const res2 = (currentPrice + baseRange * 1.2).toFixed(isForex ? 5 : 2);
  const sup1 = (currentPrice - baseRange * 0.6).toFixed(isForex ? 5 : 2);
  const sup2 = (currentPrice - baseRange * 1.2).toFixed(isForex ? 5 : 2);

  // แก้ไขจุดเข้าซื้อ (Buy Zone): ไม่ให้ต่ำเกินไป แต่อยู่ในโซน Demand ที่เข้าเทรดได้จริง
  const buyPoint1 = (currentPrice - baseRange * 0.15).toFixed(isForex ? 5 : 2);
  const buyPoint2 = (currentPrice - baseRange * 0.40).toFixed(isForex ? 5 : 2);

  const sellPoint1 = (currentPrice + baseRange * 0.15).toFixed(isForex ? 5 : 2);
  const sellPoint2 = (currentPrice + baseRange * 0.40).toFixed(isForex ? 5 : 2);

  const isBuy = currentPrice >= parseFloat(sup1);

  return {
    price: currentPrice.toFixed(isForex ? 5 : 2),
    zoneHigh1: res1,
    zoneHigh2: res2,
    zoneLow1: sup1,
    zoneLow2: sup2,
    smartOrder: {
      buy1: buyPoint1,
      buy2: buyPoint2,
      sell1: sellPoint1,
      sell2: sellPoint2
    },
    recommendation: isBuy
      ? `รอจังหวะ Re-test โซน Demand / Order Block (${buyPoint1} - ${buyPoint2})`
      : `รอราคาขึ้นทดสอบแนว Resistance / Supply Zone (${sellPoint1} - ${sellPoint2})`,
    macd: 'Bear Focus',
    tradeZone: isBuy ? 'BUY ZONE (Discount)' : 'SELL ZONE (Premium)',
    bslSsl: `BSL $${res2} / SSL $${sup2}`,
    highImpactNews: Boolean(hasNews),
    timeframe: String(tf).toUpperCase(),
    currentPrice: currentPrice
  };
}

app.get('/api/dashboard-data', async (req, res) => {
  const tf = String(req.query.tf || 'M15').toUpperCase();
  const symbol = String(req.query.symbol || 'OANDA:XAUUSD');
  const bqSymbol = normalizeBiQuoteSymbol(symbol);

  try {
    let tick = null;
    if (req.query.price !== undefined) {
      const requestedPrice = Number(req.query.price);
      if (Number.isFinite(requestedPrice) && requestedPrice > 0) {
        tick = { symbol: bqSymbol, mid: requestedPrice, source: 'query' };
      }
    }

    if (!tick) tick = await fetchBiQuoteTick(bqSymbol);

    const newsData = await fetchDailyNewsAnalysis(symbol);
    const setup = calculatePunportSetup(symbol, tf, tick.mid, newsData.hasHighImpactNews);

    res.set('Cache-Control', 'no-store');
    res.json({
      ok: true,
      symbol: symbol,
      biquoteSymbol: bqSymbol,
      timeframe: tf,
      price: tick.mid,
      market: tick,
      setup: setup,
      news: newsData
    });
  } catch (err) {
    console.error('Dashboard BiQuote error:', err.message);
    res.status(502).json({
      ok: false,
      symbol: symbol,
      biquoteSymbol: bqSymbol,
      error: 'ไม่สามารถดึงราคา Real-Time จาก BiQuote ได้',
      detail: err.message
    });
  }
});

app.get('/api/biquote/latest', async (req, res) => {
  const symbol = String(req.query.symbol || 'OANDA:XAUUSD');
  try {
    const tick = await fetchBiQuoteTick(symbol);
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, ...tick });
  } catch (err) {
    res.status(502).json({
      ok: false,
      symbol: normalizeBiQuoteSymbol(symbol),
      error: 'BiQuote price unavailable',
      detail: err.message
    });
  }
});

app.get('/api/biquote/ohlc', async (req, res) => {
  const symbol = String(req.query.symbol || 'OANDA:XAUUSD');
  const interval = String(req.query.interval || '1m').toLowerCase();
  try {
    const bars = await fetchBiQuoteOHLC(symbol, interval);
    res.set('Cache-Control', 'no-store');
    res.json({
      ok: true,
      symbol: normalizeBiQuoteSymbol(symbol),
      interval: interval,
      bars: bars
    });
  } catch (err) {
    res.status(502).json({
      ok: false,
      symbol: normalizeBiQuoteSymbol(symbol),
      interval: interval,
      error: 'BiQuote OHLC unavailable',
      detail: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});