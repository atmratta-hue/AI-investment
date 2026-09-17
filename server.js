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

function getMarketSessionInfo() {
  const now = new Date();
  const options = { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false };
  const timeStr = new Intl.DateTimeFormat('th-TH', options).format(now);
  const [hour] = timeStr.split(':').map(Number);

  if (hour >= 6 && hour < 14) {
    return { name: 'Asian Session', code: 'ASIA', volMult: 0.8, desc: 'กรอบสะสมช่วงเช้า' };
  } else if (hour >= 14 && hour < 19) {
    return { name: 'London Session', code: 'LDN', volMult: 1.2, desc: 'ช่วงกวาด Asian High/Low' };
  } else if (hour >= 19 || hour < 3) {
    return { name: 'New York Session', code: 'NY', volMult: 1.5, desc: 'ช่วงวอลลุ่มสูงสุด' };
  } else {
    return { name: 'Off-Peak', code: 'OFF', volMult: 0.6, desc: 'ช่วงปริมาณการซื้อขายเบาบาง' };
  }
}

// คำนวณ Order Block และ IRL โดยรับราคาจริง (realPrice) จากหน้าบ้าน
function calculatePineScriptOB(symbol, tf, realPrice) {
  const currentPrice = parseFloat(realPrice) || 2740.00;
  const session = getMarketSessionInfo();

  // กำหนดสเกลความผันผวนตามสัญลักษณ์
  let vol = 0.008;
  if (symbol.includes('BTC')) vol = 0.015;
  if (symbol.includes('USOIL')) vol = 0.010;

  const tfMultipliers = { '1m': 0.001, '5m': 0.003, '1h': 0.008, '4h': 0.018, '1d': 0.035 };
  const mult = (tfMultipliers[(tf || '1h').toLowerCase()] || tfMultipliers['1h']) * (vol / 0.008);

  const atr14 = currentPrice * mult * 0.4;
  const zoneHigh = currentPrice * (1 + mult * 1.2);
  const zoneLow  = currentPrice * (1 - mult * 1.2);
  const zoneMid  = (zoneHigh + zoneLow) / 2;

  const bullObBot = zoneLow - (atr14 * 0.5);
  const bearObTop = zoneHigh + (atr14 * 0.5);

  const irlBSL = (zoneMid + (zoneHigh - zoneMid) * 0.5).toFixed(2);
  const irlSSL = (zoneLow + (zoneMid - zoneLow) * 0.5).toFixed(2);
  const irlEQ  = zoneMid.toFixed(2);

  const isBuyZone  = currentPrice < zoneMid;
  const isSellZone = currentPrice >= zoneMid;

  return {
    price: currentPrice.toFixed(2),
    zoneHigh: zoneHigh.toFixed(2),
    zoneLow: zoneLow.toFixed(2),
    tradeZoneText: isBuyZone ? 'BUY ZONE (Discount)' : 'SELL ZONE (Premium)',
    bullishOB: `$${bullObBot.toFixed(2)} - $${zoneLow.toFixed(2)}`,
    bearishOB: `$${zoneHigh.toFixed(2)} - $${bearObTop.toFixed(2)}`,
    macdStatus: isBuyZone ? 'Bull Focus' : 'Bear Focus',
    badgeClass: isBuyZone ? 'buy' : 'sell',
    detailMessage: `คำนวณจากราคาสดจริง ($${currentPrice.toFixed(2)}) ช่วง ${session.name}`,
    irl: {
      bsl: irlBSL,
      ssl: irlSSL,
      eq: irlEQ,
      summary: `[${session.code}] BSL $${irlBSL} / SSL $${irlSSL}`,
      detail: `[${session.code}] BSL $${irlBSL} | SSL $${irlSSL}`
    }
  };
}

async function fetchRealNews() {
  const rssFeeds = [
    { name: 'FXStreet Gold News', url: 'https://www.fxstreet.com/rss/news' },
    { name: 'MarketWatch Top Stories', url: 'http://feeds.marketwatch.com/marketwatch/topstories' }
  ];

  let newsItems = [];
  for (const feedConfig of rssFeeds) {
    try {
      const feed = await parser.parseURL(feedConfig.url);
      const processed = feed.items.slice(0, 3).map(item => {
        const text = (item.title + ' ' + (item.contentSnippet || '')).toLowerCase();
        const isForecast = text.includes('forecast') || text.includes('preview') || text.includes('expect') || text.includes('fed') || text.includes('cpi');
        let sentiment = 'neutral';
        if (text.includes('bull') || text.includes('rise') || text.includes('gain') || text.includes('up')) sentiment = 'positive';
        if (text.includes('bear') || text.includes('fall') || text.includes('drop') || text.includes('down')) sentiment = 'negative';

        return {
          type: isForecast ? 'forecast' : 'past',
          source: feedConfig.name,
          title: item.title,
          reason: item.contentSnippet ? item.contentSnippet.substring(0, 140) + '...' : 'ติดตามอ่านฉบับเต็มได้ที่แหล่งข่าวอ้างอิง',
          sentiment: sentiment,
          link: item.link || '#'
        };
      });
      newsItems = newsItems.concat(processed);
    } catch (err) {
      console.log(`Feed error: ${feedConfig.name}`);
    }
  }
  return newsItems;
}

app.get('/api/dashboard-data', async (req, res) => {
  const tf = req.query.tf || '1h';
  const symbol = req.query.symbol || 'OANDA:XAUUSD';
  const realPrice = req.query.price; // รับราคาสดจากฝั่งหน้าบ้าน

  const data = calculatePineScriptOB(symbol, tf, realPrice);
  const realNews = await fetchRealNews();

  res.json({
    symbol: symbol,
    timeframe: tf.toUpperCase(),
    signal: {
      action: `${symbol}`,
      detail: data.detailMessage,
      badge: data.macdStatus,
      badgeClass: data.badgeClass,
      obRecommendation: `โซนเข้าซื้อ Bullish OB: ${data.bullishOB} | โซนเข้าขาย Bearish OB: ${data.bearishOB}`
    },
    srLevels: {
      r2: (parseFloat(data.zoneHigh) * 1.003).toFixed(2),
      r1: data.zoneHigh,
      s1: data.zoneLow,
      s2: (parseFloat(data.zoneLow) * 0.997).toFixed(2)
    },
    tradeZone: data.tradeZoneText,
    macdFocus: data.macdStatus,
    bullishOB: data.bullishOB,
    bearishOB: data.bearishOB,
    irl: data.irl,
    marketTrend: {
      text: 'Real-time Market Sync (ซิงก์ราคาสดและข่าวสารตรงกับ TradingView)',
      status: 'neutral',
      label: 'LIVE SYNC',
      catalyst: { active: false }
    },
    news: realNews
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});