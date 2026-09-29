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

// =====================================================
// 1. STRICT ASSET KEYWORD MAPPING RULES (ป้องกัน News Mismatch)
// =====================================================
const ASSET_NEWS_RULES = {
  'XAUUSD': {
    primary: ['gold', 'xau', 'bullion', 'ทองคำ', 'precious metal'],
    macro: ['fed', 'cpi', 'nfp', 'inflation', 'interest rate', 'dxy', 'us dollar'],
    exclude: ['crude oil', 'brent', 'opec', 'bitcoin', 'crypto']
  },
  'USOIL': {
    primary: ['crude oil', 'oil', 'wti', 'brent', 'opec', 'eia', 'น้ำมันดิบ'],
    macro: ['energy', 'middle east', 'inventory', 'geopolitics'],
    exclude: ['gold', 'xau', 'bitcoin', 'crypto', 'forex']
  },
  'BTCUSD': {
    primary: ['bitcoin', 'btc', 'crypto', 'sec', 'etf', 'on-chain', 'คริปโท'],
    macro: ['fed', 'liquidity', 'nasdaq'],
    exclude: ['crude oil', 'opec', 'eia', 'gold bullion']
  },
  'EURUSD': {
    primary: ['eur', 'eurusd', 'ecb', 'eurozone', 'euro'],
    macro: ['fed', 'cpi', 'nfp', 'interest rate'],
    exclude: ['crypto', 'bitcoin', 'crude oil', 'opec']
  }
};

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
    'OANDA:WTICOUSD': 'USOIL',
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
      timestamp: tick.timestamp || null,
      source: tick.source || 'BiQuote'
    };
  } finally {
    clearTimeout(timeout);
  }
}

// =====================================================
// 2. DYNAMIC & STRICT NEWS FILTERING ENGINE
// =====================================================
async function fetchDailyNewsAnalysis(symbol) {
  const bqSymbol = normalizeBiQuoteSymbol(symbol);
  const rules = ASSET_NEWS_RULES[bqSymbol] || ASSET_NEWS_RULES['XAUUSD'];

  const rssFeeds = [
    { name: 'FXStreet News', url: 'https://www.fxstreet.com/rss/news' },
    { name: 'MarketWatch Top Stories', url: 'http://feeds.marketwatch.com/marketwatch/topstories' }
  ];

  let filteredNews = [];
  let hasHighImpactNews = false;

  for (const feedConfig of rssFeeds) {
    try {
      const feed = await parser.parseURL(feedConfig.url);
      for (const item of feed.items) {
        const fullText = (item.title + ' ' + (item.contentSnippet || '')).toLowerCase();

        // Layer 1: Check Exclusion List (ตัดข่าวที่ไม่เกี่ยวข้องออกทันที)
        const isExcluded = rules.exclude.some(ex => fullText.includes(ex));
        if (isExcluded) continue;

        // Layer 2: Primary or Macro Match
        const isPrimaryMatch = rules.primary.some(p => fullText.includes(p));
        const isMacroMatch = rules.macro.some(m => fullText.includes(m));

        if (isPrimaryMatch || isMacroMatch) {
          if (fullText.includes('cpi') || fullText.includes('nfp') || fullText.includes('fed rate') || fullText.includes('fomc')) {
            hasHighImpactNews = true;
          }

          let sentiment = 'neutral';
          let sentimentText = 'ผลกระทบ: ปานกลาง (Neutral) 🟡';
          if (fullText.includes('surge') || fullText.includes('jump') || fullText.includes('high') || fullText.includes('bull')) {
            sentiment = 'bullish';
            sentimentText = 'ผลกระทบ: บวก (Bullish) 🟢';
          } else if (fullText.includes('drop') || fullText.includes('fall') || fullText.includes('plunge') || fullText.includes('bear')) {
            sentiment = 'bearish';
            sentimentText = 'ผลกระทบ: ลบ (Bearish) 🔴';
          }

          filteredNews.push({
            source: feedConfig.name,
            sentiment: sentiment,
            sentimentText: sentimentText,
            title: item.title,
            reason: item.contentSnippet ? item.contentSnippet.substring(0, 140) + '...' : 'ติดตามอ่านรายละเอียดจากบทความฉบับเต็ม',
            url: item.link || '#',
            date: item.pubDate ? new Date(item.pubDate).toISOString().split('T')[0] : 'ล่าสุด'
          });
        }

        if (filteredNews.length >= 6) break; // จำกัดข่าวสอดคล้องไม่เกิน 6 ข่าว
      }
    } catch (err) {
      console.log(`Feed fetch error: ${feedConfig.name}`);
    }
  }

  return { hasHighImpactNews, newsList: filteredNews };
}

// =====================================================
// 3. RECALCULATE REALISTIC BUY / SELL TRADING SETUP
// =====================================================
function calculatePunportSetup(symbol, tf, realPrice, hasNews) {
  const currentPrice = Number.isFinite(Number(realPrice)) && Number(realPrice) > 0 ? Number(realPrice) : 0;
  if (!currentPrice) throw new Error('Invalid market price');

  const bqSymbol = normalizeBiQuoteSymbol(symbol);
  const isForex = bqSymbol === 'EURUSD';
  const isOil = bqSymbol === 'USOIL';

  let volatilityRatio = 0.0035;
  if (isForex) volatilityRatio = 0.0015;
  if (isOil) volatilityRatio = 0.0050;

  const baseRange = currentPrice * volatilityRatio;

  const res1 = (currentPrice + baseRange * 0.6).toFixed(isForex ? 5 : 2);
  const res2 = (currentPrice + baseRange * 1.2).toFixed(isForex ? 5 : 2);
  const sup1 = (currentPrice - baseRange * 0.6).toFixed(isForex ? 5 : 2);
  const sup2 = (currentPrice - baseRange * 1.2).toFixed(isForex ? 5 : 2);

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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});