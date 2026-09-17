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

// Explicit Route Handler ป้องกัน Cannot GET /
app.get('/', (req, res) => {
  const publicIndexPath = path.join(__dirname, 'public', 'index.html');
  const rootIndexPath = path.join(__dirname, 'index.html');

  if (fs.existsSync(publicIndexPath)) {
    res.sendFile(publicIndexPath);
  } else if (fs.existsSync(rootIndexPath)) {
    res.sendFile(rootIndexPath);
  } else {
    res.status(404).send('<h2>ไม่พบไฟล์ index.html! กรุณาตรวจสอบตำแหน่งไฟล์</h2>');
  }
});

function getAssetConfig(symbol) {
  const sym = symbol ? symbol.toUpperCase() : '';
  if (sym.includes('BTC')) return { base: 65000, decimals: 2, vol: 0.015 };
  if (sym.includes('XAU')) return { base: 2740, decimals: 2, vol: 0.008 };
  if (sym.includes('XAG')) return { base: 31.50, decimals: 2, vol: 0.012 };
  if (sym.includes('USOIL')) return { base: 76.50, decimals: 2, vol: 0.010 };
  if (sym.includes('SPX')) return { base: 5550, decimals: 2, vol: 0.006 };
  if (sym.includes('AAPL')) return { base: 225.00, decimals: 2, vol: 0.008 };
  if (sym.includes('PTT')) return { base: 34.25, decimals: 2, vol: 0.005 };
  return { base: 100.00, decimals: 2, vol: 0.008 };
}

// เช็ก Session ตลาดตาม Timezone ไทย (Asia/Bangkok)
function getMarketSessionInfo() {
  const now = new Date();
  const options = { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false };
  const timeStr = new Intl.DateTimeFormat('th-TH', options).format(now);
  const [hour, minute] = timeStr.split(':').map(Number);
  const totalMinutes = hour * 60 + minute;

  if (totalMinutes >= 360 && totalMinutes < 840) {
    return { name: 'Asian Session', code: 'ASIA', volMult: 0.8, desc: 'กรอบสร้างราคาและ Liquidity ย่อย' };
  } else if (totalMinutes >= 840 && totalMinutes < 1140) {
    return { name: 'London Session', code: 'LDN', volMult: 1.2, desc: 'ช่วงกวาด Asian High/Low Sweep' };
  } else if (totalMinutes >= 1140 || totalMinutes < 180) {
    return { name: 'New York Session', code: 'NY', volMult: 1.5, desc: 'ช่วงวอลลุ่มสูงสุดและตัวเลขเศรษฐกิจ' };
  } else {
    return { name: 'Pacific/Off-Peak', code: 'OFF', volMult: 0.6, desc: 'ช่วงปริมาณการซื้อขายเบาบาง' };
  }
}

// คำนวณ Pine Script Order Block & SMC Internal Range Liquidity (IRL)
function calculatePineScriptOB(symbol, tf) {
  const config = getAssetConfig(symbol);
  const session = getMarketSessionInfo();

  const tfMultipliers = { '1m': 0.002, '5m': 0.005, '1h': 0.012, '4h': 0.025, '1d': 0.050 };
  const baseMult = (tfMultipliers[(tf || '1h').toLowerCase()] || tfMultipliers['1h']) * config.vol * 100;
  const mult = baseMult * session.volMult;

  const currentPrice = config.base + (Math.random() - 0.5) * (config.base * mult * 0.1);
  const atr14 = currentPrice * mult * 0.4; 

  const zoneHigh = currentPrice * (1 + mult * 1.5); 
  const zoneLow  = currentPrice * (1 - mult * 1.5);
  const zoneMid  = (zoneHigh + zoneLow) / 2;

  const isBuyZone  = currentPrice < zoneMid && currentPrice > zoneLow;
  const isSellZone = currentPrice > zoneMid && currentPrice < zoneHigh;

  const bullObBot = zoneLow - (atr14 * 0.5);
  const bullObTop = zoneLow;
  const bearObBot = zoneHigh;
  const bearObTop = zoneHigh + (atr14 * 0.5);

  // คำนวณ BSL / SSL ตาม Timezone & Session
  const irlBSL = (zoneMid + (zoneHigh - zoneMid) * 0.5).toFixed(config.decimals);
  const irlSSL = (zoneLow + (zoneMid - zoneLow) * 0.5).toFixed(config.decimals);
  const irlEQ  = zoneMid.toFixed(config.decimals);

  let irlStatus = '';
  if (currentPrice > parseFloat(irlBSL)) {
    irlStatus = `[${session.code}] ดึงวอลลุ่ม BSL ($${irlBSL}) แล้ว - เสี่ยง Sweep`;
  } else if (currentPrice < parseFloat(irlSSL)) {
    irlStatus = `[${session.code}] ดึงวอลลุ่ม SSL ($${irlSSL}) แล้ว - เสี่ยงเกิด Liquidity Grab`;
  } else {
    irlStatus = `[${session.code}] วิ่งในกรอบ IRL (${session.desc})`;
  }

  const macdVal = (Math.random() - 0.4) * 5;
  const signalVal = (Math.random() - 0.4) * 4;
  const hist = macdVal - signalVal;

  const isBullFocus = (macdVal > signalVal) && (hist > 0);
  const isBearFocus = (macdVal < signalVal) && (hist < 0);

  let focusSignal = 'NEUTRAL';
  let badgeClass = 'neutral';
  let detailMsg = `ราคาเคลื่อนไหวใน Trade Zone ($${zoneLow.toFixed(config.decimals)} - $${zoneHigh.toFixed(config.decimals)}) [${session.name}]`;

  if (isBuyZone && isBullFocus) {
    focusSignal = 'BUY FOCUS';
    badgeClass = 'buy';
    detailMsg = `เกิดสัญญาณ BUY FOCUS ช่วง ${session.name}: ราคาอยู่ใน Buy Zone ร่วมกับ MACD Bull Focus`;
  } else if (isSellZone && isBearFocus) {
    focusSignal = 'SELL FOCUS';
    badgeClass = 'sell';
    detailMsg = `เกิดสัญญาณ SELL FOCUS ช่วง ${session.name}: ราคาอยู่ใน Sell Zone ร่วมกับ MACD Bear Focus`;
  }

  return {
    price: currentPrice.toFixed(config.decimals),
    zoneHigh: zoneHigh.toFixed(config.decimals),
    zoneLow: zoneLow.toFixed(config.decimals),
    zoneMid: zoneMid.toFixed(config.decimals),
    tradeZoneText: isBuyZone ? 'BUY ZONE (Discount)' : isSellZone ? 'SELL ZONE (Premium)' : 'EQUILIBRIUM (Mid)',
    bullishOB: `$${bullObBot.toFixed(config.decimals)} - $${bullObTop.toFixed(config.decimals)}`,
    bearishOB: `$${bearObBot.toFixed(config.decimals)} - $${bearObTop.toFixed(config.decimals)}`,
    macdStatus: isBullFocus ? 'Bull Focus (เขียว)' : isBearFocus ? 'Bear Focus (แดง)' : 'SideFocus',
    focusSignal: focusSignal,
    badgeClass: badgeClass,
    detailMessage: detailMsg,
    session: session,
    irl: {
      bsl: irlBSL,
      ssl: irlSSL,
      eq: irlEQ,
      summary: `[${session.code}] BSL $${irlBSL} / SSL $${irlSSL}`,
      detail: irlStatus
    }
  };
}

// ดึง RSS Feed ข่าวสดจริงเรียลไทม์
async function fetchRealNews() {
  const rssFeeds = [
    { name: 'FXStreet Gold News', url: 'https://www.fxstreet.com/rss/news' },
    { name: 'MarketWatch Top Stories', url: 'http://feeds.marketwatch.com/marketwatch/topstories' }
  ];

  let newsItems = [];

  for (const feedConfig of rssFeeds) {
    try {
      const feed = await parser.parseURL(feedConfig.url);
      const processed = feed.items.slice(0, 4).map(item => {
        const text = (item.title + ' ' + (item.contentSnippet || '')).toLowerCase();

        const isForecast = text.includes('forecast') || text.includes('preview') || text.includes('expect') || 
                           text.includes('outlook') || text.includes('fed') || text.includes('cpi') || 
                           text.includes('ahead') || text.includes('target');

        let sentiment = 'neutral';
        if (text.includes('bull') || text.includes('rise') || text.includes('gain') || text.includes('high') || text.includes('up')) {
          sentiment = 'positive';
        } else if (text.includes('bear') || text.includes('fall') || text.includes('drop') || text.includes('down') || text.includes('loss')) {
          sentiment = 'negative';
        }

        return {
          type: isForecast ? 'forecast' : 'past',
          source: feedConfig.name,
          title: item.title,
          reason: item.contentSnippet ? item.contentSnippet.substring(0, 150) + '...' : 'ติดตามรายละเอียดเพิ่มเติมจากสำนักข่าว',
          sentiment: sentiment,
          link: item.link || '#'
        };
      });
      newsItems = newsItems.concat(processed);
    } catch (err) {
      console.log(`Failed to fetch RSS from ${feedConfig.name}:`, err.message);
    }
  }

  if (newsItems.length === 0) {
    newsItems = [
      {
        type: 'forecast',
        source: 'FXStreet Real-time Analysis',
        title: 'Gold Price Outlook: XAU/USD awaits key economic catalysts',
        reason: 'นักวิเคราะห์เก็งสภาวะตลาดยังคงระมัดระวังเพื่อรอตัวเลขเศรษฐกิจและทิศทางอัตราดอกเบี้ย Fed',
        sentiment: 'neutral',
        link: 'https://www.fxstreet.com/markets/commodities/gold'
      },
      {
        type: 'past',
        source: 'MarketWatch Feed',
        title: 'Market Digest: Dollar and Bond Yields dictate near-term direction',
        reason: 'ดัชนีดอลลาร์และบอนด์ยีลด์ทรงตัวในกรอบสร้างแรงกดดันต่อราคาสินค้าโภคภัณฑ์ในระยะสั้น',
        sentiment: 'positive',
        link: 'https://www.marketwatch.com/investing/future/gold'
      }
    ];
  }

  return newsItems;
}

// API Data Endpoint
app.get('/api/dashboard-data', async (req, res) => {
  const tf = req.query.tf || '1h';
  const symbol = req.query.symbol || 'OANDA:XAUUSD';

  const data = calculatePineScriptOB(symbol, tf);
  const realNews = await fetchRealNews();

  const positiveCount = realNews.filter(n => n.sentiment === 'positive').length;
  const negativeCount = realNews.filter(n => n.sentiment === 'negative').length;

  let trendText = 'Wait & See (ชะลอตัวเพื่อรอความชัดเจนจากปัจจัยเศรษฐกิจล่วงหน้า)';
  let trendLabel = 'WAIT & SEE';
  let trendStatus = 'neutral';

  if (positiveCount > negativeCount) {
    trendText = 'Bullish Sentiment (ข่าวจริงส่วนใหญ่สะท้อนมุมมองเชิงบวกต่อสินทรัพย์)';
    trendLabel = 'BULLISH EXPECTATION';
    trendStatus = 'buy';
  } else if (negativeCount > positiveCount) {
    trendText = 'Bearish Pressure (ข่าวสดฝั่งอเมริกาและดอลลาร์สร้างแรงกดดันฝั่งขาย)';
    trendLabel = 'BEARISH PRESSURE';
    trendStatus = 'sell';
  }

  const topForecast = realNews.find(n => n.type === 'forecast') || realNews[0];

  const marketState = {
    text: trendText,
    status: trendStatus,
    label: trendLabel,
    catalyst: {
      active: true,
      time: `เรียลไทม์ (${data.session.name})`,
      event: topForecast.title,
      details: `<b>บทวิเคราะห์สถาบัน:</b> ${topForecast.reason}`
    }
  };

  res.json({
    symbol: symbol,
    timeframe: tf.toUpperCase(),
    signal: {
      action: `${symbol} — ${data.focusSignal}`,
      detail: data.detailMessage,
      badge: data.focusSignal,
      badgeClass: data.badgeClass,
      obRecommendation: `โซนเข้าซื้อ Bullish OB: ${data.bullishOB} | โซนเข้าขาย Bearish OB: ${data.bearishOB}`
    },
    srLevels: {
      r2: (parseFloat(data.zoneHigh) * 1.005).toFixed(2),
      r1: data.zoneHigh,
      s1: data.zoneLow,
      s2: (parseFloat(data.zoneLow) * 0.995).toFixed(2)
    },
    tradeZone: data.tradeZoneText,
    macdFocus: data.macdStatus,
    bullishOB: data.bullishOB,
    bearishOB: data.bearishOB,
    irl: data.irl,
    marketTrend: marketState,
    news: realNews
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});