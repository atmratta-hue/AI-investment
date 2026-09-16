require('dotenv').config();
const express = require('express');
const path = require('path');
const Parser = require('rss-parser');
const axios = require('axios');
const cheerio = require('cheerio'); // ใช้สำหรับแกะ HTML จาก Investing.com

const app = express();
const PORT = process.env.PORT || 3000;
const rssParser = new Parser();

app.use(express.static(path.join(__dirname, 'public')));

const cacheStore = {};
const CACHE_TTL = 10 * 1000; // Cache 10 วินาที

// ฟังก์ชั่นดึงราคา XAU/USD และเวลาอัปเดตจาก Investing.com
async function fetchInvestingGoldPrice() {
  try {
    const url = 'https://th.investing.com/currencies/xau-usd';
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
        'Accept-Language': 'th-TH,th;q=0.9,en;q=0.8'
      },
      timeout: 5000
    });

    const $ = cheerio.load(response.data);

    // ดึงราคาจาก Attribute หรือ Selector ของ Investing.com
    let priceText = $('[data-test="instrument-price-last"]').text().trim();
    let changePercent = $('[data-test="instrument-price-change-percent"]').text().trim();
    let timeText = $('time').first().text().trim();

    // กรณีหา Selector หลักไม่พบ (Fallback selector)
    if (!priceText) {
      priceText = $('.text-5xl').text().trim();
    }

    if (!priceText) {
      throw new Error('Price selector not found');
    }

    // จัดรูปแบบตัวเลขราคา
    const priceFormatted = parseFloat(priceText.replace(/,/g, '')).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    return {
      price: priceFormatted,
      change: changePercent || '0.00%',
      updatedAt: timeText || new Date().toLocaleTimeString('th-TH')
    };

  } catch (err) {
    console.error('Error fetching from Investing.com:', err.message);
    // กรณีถูกบล็อกหรือมีข้อผิดพลาด ให้ส่งค่าสำรองแบบเรียลไทม์จาก Stooq
    return null;
  }
}

// 1. คำนวณ Stochastic Oscillator (%K, %D)
function calculateStochastic(candles, kPeriod = 14, dPeriod = 3) {
  if (!candles || candles.length < kPeriod + dPeriod) {
    return { k: 50, d: 50, trend: 'ขาขึ้น' };
  }

  const kValues = [];
  for (let i = kPeriod - 1; i < candles.length; i++) {
    const slice = candles.slice(i - kPeriod + 1, i + 1);
    const highestHigh = Math.max(...slice.map(c => c.high));
    const lowestLow = Math.min(...slice.map(c => c.low));
    const currentClose = slice[slice.length - 1].close;

    let k = 50;
    if (highestHigh !== lowestLow) {
      k = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
    }
    kValues.push(k);
  }

  const currentK = kValues[kValues.length - 1];
  const prevK = kValues[kValues.length - 2] || currentK;
  const recentK = kValues.slice(-dPeriod);
  const currentD = recentK.reduce((sum, val) => sum + val, 0) / recentK.length;

  const trend = currentK >= prevK ? 'ขาขึ้น' : 'ขาลง';

  return {
    k: parseFloat(currentK.toFixed(2)),
    d: parseFloat(currentD.toFixed(2)),
    trend: trend
  };
}

// 2. วิเคราะห์ SMC Structure & Zone
function analyzeSMC(candles) {
  if (!candles || candles.length < 15) {
    return { structure: 'Sideway', zone: 'Equilibrium', orderBlock: 'None', trend: 'ขาขึ้น' };
  }

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);

  const highestHigh = Math.max(...highs);
  const lowestLow = Math.min(...lows);
  const currentPrice = closes[closes.length - 1];
  const eqPrice = (highestHigh + lowestLow) / 2;

  const zone = currentPrice > eqPrice ? 'Premium (โซนแพง)' : 'Discount (โซนถูก)';
  const recentHigh = Math.max(...highs.slice(-10, -1));
  const recentLow = Math.min(...lows.slice(-10, -1));

  let structure = 'Sideway';
  let trend = currentPrice >= closes[0] ? 'ขาขึ้น' : 'ขาลง';

  if (currentPrice > recentHigh) {
    structure = 'Bullish BOS';
    trend = 'ขาขึ้น';
  } else if (currentPrice < recentLow) {
    structure = 'Bearish BOS';
    trend = 'ขาลง';
  }

  let orderBlock = trend === 'ขาขึ้น' ? `Bullish OB (~${recentLow.toFixed(2)})` : `Bearish OB (~${recentHigh.toFixed(2)})`;

  return { structure, zone, orderBlock, trend };
}

// 3. ดึงข่าวจาก RYT9
async function fetchNews() {
  try {
    const feed = await rssParser.parseURL('https://www.ryt9.com/tag/%E0%B8%97%E0%B8%AD%E0%B8%87%E0%B8%84%E0%B8%B3/rss.xml');
    const keywordsBullish = ['พุ่ง', 'ขึ้น', 'บวก', 'หนุน', 'สูงสุด', 'เด้ง', 'ซื้อ', 'อ่อนค่า'];
    const keywordsBearish = ['ร่วง', 'ลง', 'ลบ', 'ดิ่ง', 'กดดัน', 'ปรับฐาน', 'แข็งค่า', 'ขาย'];

    return feed.items.slice(0, 6).map(item => {
      const title = item.title || '';
      let sentiment = 'neutral';
      let reason = 'ข่าวยังไม่ส่งผลต่อทิศทางราคาชัดเจน';

      const bullMatches = keywordsBullish.filter(k => title.includes(k));
      const bearMatches = keywordsBearish.filter(k => title.includes(k));

      if (bullMatches.length > bearMatches.length) {
        sentiment = 'positive';
        reason = `ปัจจัยบวกต่อราคาทองคำ (${bullMatches.join(', ')})`;
      } else if (bearMatches.length > bearMatches.length) {
        sentiment = 'negative';
        reason = `ปัจจัยกดดันราคาทองคำ (${bearMatches.join(', ')})`;
      }

      return { title, link: item.link, pubDate: item.pubDate, sentiment, reason };
    });
  } catch (err) {
    return [
      { title: 'ตลาดยังคงจับตาตัวเลขเศรษฐกิจสหรัฐฯ และอัตราดอกเบี้ยเฟด', sentiment: 'neutral', reason: 'รอปัจจัยใหม่เข้ามาหนุนราคา', link: '#' }
    ];
  }
}

// 4. ดึงกราฟแท่งเทียน
async function fetchGoldCandles(timeframe = '1h') {
  try {
    const intervalMap = { '1m': '1m', '5m': '5m', '1h': 'h', '4h': '4h', '1d': 'd' };
    const interval = intervalMap[timeframe] || 'h';
    const url = `https://stooq.com/q/d/l/?s=xauusd&i=${interval}`;

    const resp = await axios.get(url, { timeout: 3000 });
    const lines = resp.data.trim().split('\n');
    let candles = [];

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length >= 5) {
        const open = parseFloat(parts[1]);
        const high = parseFloat(parts[2]);
        const low = parseFloat(parts[3]);
        const close = parseFloat(parts[4]);
        if (!isNaN(close)) candles.push({ open, high, low, close });
      }
    }
    return candles;
  } catch (err) {
    return [];
  }
}

// 5. API Main Endpoint
app.get('/api/dashboard-data', async (req, res) => {
  try {
    const timeframe = (req.query.tf || '1h').toLowerCase();
    const validTFs = ['1m', '5m', '1h', '4h', '1d'];
    const selectedTF = validTFs.includes(timeframe) ? timeframe : '1h';

    // ดึงราคา real-time จาก Investing.com
    const investingData = await fetchInvestingGoldPrice();

    const candles = await fetchGoldCandles(selectedTF);
    const stoch = calculateStochastic(candles);
    const smc = analyzeSMC(candles);
    const news = await fetchNews();

    // เงื่อนไข Stochastic 0-20 (โซนซื้อ), 80-100 (โซนขาย), 20-80 (ดูแนวโน้ม)
    let card1DisplayStatus = '';
    let card1Color = 'neutral';

    if (stoch.k >= 0 && stoch.k <= 20) {
      card1DisplayStatus = 'โซนซื้อ';
      card1Color = 'positive';
    } else if (stoch.k >= 80 && stoch.k <= 100) {
      card1DisplayStatus = 'โซนขาย';
      card1Color = 'negative';
    } else {
      card1DisplayStatus = stoch.trend;
      card1Color = stoch.trend === 'ขาขึ้น' ? 'positive' : 'negative';
    }

    const currentPriceText = investingData ? investingData.price : (candles.length > 0 ? candles[candles.length - 1].close.toFixed(2) : '2,740.50');
    const currentChangeText = investingData ? investingData.change : '0.00%';
    const currentTimeText = investingData ? investingData.updatedAt : new Date().toLocaleTimeString('th-TH');

    const responseData = {
      timeframe: selectedTF.toUpperCase(),
      price: currentPriceText,
      change: currentChangeText,
      updatedAt: currentTimeText,
      signal: {
        action: `สถานะ: ${card1DisplayStatus}`,
        detail: `Stochastic %K อยู่ที่ ${stoch.k} | SMC Structure: ${smc.structure} (${smc.zone})`,
        badge: card1Color
      },
      card1Status: card1DisplayStatus,
      card1Color: card1Color,
      stochasticRaw: stoch,
      smc: smc,
      news: news
    };

    res.json(responseData);
  } catch (err) {
    res.status(500).json({ error: 'Server Error' });
  }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));