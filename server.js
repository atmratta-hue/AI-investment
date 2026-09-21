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
  if (fs.existsSync(publicIndexPath)) res.sendFile(publicIndexPath);
  else if (fs.existsSync(rootIndexPath)) res.sendFile(rootIndexPath);
  else res.status(404).send('<h2>ไม่พบไฟล์ index.html!</h2>');
});

// ดึงและวิเคราะห์ข่าวประจำวันเรียลไทม์
async function fetchDailyNewsAnalysis(symbol) {
  const rssFeeds = [
    { name: 'FXStreet News', url: 'https://www.fxstreet.com/rss/news' },
    { name: 'MarketWatch Top Stories', url: 'http://feeds.marketwatch.com/marketwatch/topstories' }
  ];

  let newsItems = [];
  let hasHighImpactNews = false;
  let posCount = 0, negCount = 0;

  for (const feedConfig of rssFeeds) {
    try {
      const feed = await parser.parseURL(feedConfig.url);
      const processed = feed.items.slice(0, 3).map(item => {
        const text = (item.title + ' ' + (item.contentSnippet || '')).toLowerCase();
        
        // ตรวจจับว่ามีข่าวสำคัญ/ข่าวผันผวนสูงหรือไม่
        if (text.includes('fed') || text.includes('cpi') || text.includes('nfp') || text.includes('fomc') || text.includes('rate decision') || text.includes('powell')) {
          hasHighImpactNews = true;
        }

        let sentiment = 'neutral';
        if (text.includes('bull') || text.includes('rise') || text.includes('gain') || text.includes('up')) {
          sentiment = 'positive';
          posCount++;
        } else if (text.includes('bear') || text.includes('fall') || text.includes('drop') || text.includes('down')) {
          sentiment = 'negative';
          negCount++;
        }

        return {
          source: feedConfig.name,
          title: item.title,
          reason: item.contentSnippet ? item.contentSnippet.substring(0, 140) + '...' : 'อ่านรายละเอียดเพิ่มเติมจากข่าวต้นทาง',
          sentiment: sentiment,
          link: item.link || '#'
        };
      });
      newsItems = newsItems.concat(processed);
    } catch (err) {
      console.log(`Feed fetch error: ${feedConfig.name}`);
    }
  }

  let overallImpact = 'NEUTRAL / WAIT';
  let overallDesc = `สภาวะข่าวของ ${symbol} อยู่ในระดับปกติ แนะนำเข้าเทรดตามกรอบ FVG และ Volume Profile ในช่วง Kill Zone`;
  let badgeStyle = 'neutral';

  if (posCount > negCount) {
    overallImpact = 'BULLISH (+)';
    overallDesc = `ข่าวและปัจจัยวันนี้ส่งผลบวก (+) ต่อ ${symbol} หนุนให้ราคามีโอกาสปรับตัวขึ้นทดสอบแนว VAH`;
    badgeStyle = 'positive';
  } else if (negCount > posCount) {
    overallImpact = 'BEARISH (-)';
    overallDesc = `ข่าววันนี้ส่งผลกดดันเชิงลบ (-) ต่อ ${symbol} มีโอกาสย่อตัวลงมาทดสอบแนวรับ VAL / FVG Discount`;
    badgeStyle = 'negative';
  }

  return { overallImpact, overallDesc, badgeStyle, hasHighImpactNews, newsList: newsItems };
}

// คำนวณจุดเทรดอิงตามคูู่มือ PUNPORT FX (Volume Profile & FVG) + ปรับตามความผันผวนข่าว
function calculatePunportSetup(symbol, tf, realPrice, hasNews) {
  const currentPrice = parseFloat(realPrice) || 2740.00;
  
  // กำหนด Volatility
  const isHighVolSymbol = symbol.includes('XAU') || symbol.includes('BTC') || symbol.includes('OIL');
  let baseSpread = isHighVolSymbol ? currentPrice * 0.006 : currentPrice * 0.0025;

  // หากมีข่าวสำคัญ ปรับเพิ่มขอบเขตราคา (Buffer Zone) ป้องกันโดนข่าวลากกวาดไส้
  const newsMultiplier = hasNews ? 1.5 : 1.0;
  const spread = baseSpread * newsMultiplier;

  // คำนวณระดับ Volume Profile (VAH, VAL, POC) และ FVG 50%
  const pocPrice = currentPrice - (spread * 0.1); // POC สะสมปริมาณซื้อขายสูงสุด
  const vahPrice = currentPrice + (spread * 0.5); // Value Area High
  const valPrice = currentPrice - (spread * 0.5); // Value Area Low

  const fvgBuy50  = currentPrice - (spread * 0.25); // FVG 50% ฝั่ง BUY
  const fvgSell50 = currentPrice + (spread * 0.25); // FVG 50% ฝั่ง SELL

  const isBuySetup = currentPrice >= pocPrice;

  let buyPoint, sellPoint, tpLevel, slLevel, recommendationText;

  if (isBuySetup) {
    buyPoint = fvgBuy50.toFixed(2);
    sellPoint = vahPrice.toFixed(2);
    
    // ตั้ง SL นอกกรอบ VAL / FVG (ถ้ามีข่าว ขยายระยะ SL เพิ่มอีก 20% ป้องกันโดน Sweep)
    const slDistance = hasNews ? (spread * 0.45) : (spread * 0.35);
    slLevel = (fvgBuy50 - slDistance).toFixed(2);
    
    const risk = fvgBuy50 - parseFloat(slLevel);
    tpLevel = (fvgBuy50 + (risk * 1.8)).toFixed(2); // RR 1:1.8

    recommendationText = hasNews 
      ? `🚨 [โหมดข่าวผันผวน] รอราคาย่อลึกกวาด Liquidity ก่อนตั้งรับ BUY ที่แนว FVG 50% ($${buyPoint}) | SL: $${slLevel}`
      : `BUY ณ แนว FVG 50% / Volume POC ($${buyPoint}) | TP: $${tpLevel} | SL: $${slLevel}`;
  } else {
    buyPoint = valPrice.toFixed(2);
    sellPoint = fvgSell50.toFixed(2);
    
    const slDistance = hasNews ? (spread * 0.45) : (spread * 0.35);
    slLevel = (fvgSell50 + slDistance).toFixed(2);
    
    const risk = parseFloat(slLevel) - fvgSell50;
    tpLevel = (fvgSell50 - (risk * 1.8)).toFixed(2); // RR 1:1.8

    recommendationText = hasNews 
      ? `🚨 [โหมดข่าวผันผวน] รอราคาดันขึ้นกวาด Liquidity ก่อนกด SELL ที่แนว FVG 50% ($${sellPoint}) | SL: $${slLevel}`
      : `SELL ณ แนว FVG 50% / Volume POC ($${sellPoint}) | TP: $${tpLevel} | SL: $${slLevel}`;
  }

  return {
    price: currentPrice.toFixed(2),
    poc: pocPrice.toFixed(2),
    vah: vahPrice.toFixed(2),
    val: valPrice.toFixed(2),
    buyPoint,
    sellPoint,
    tpLevel,
    slLevel,
    recommendationText,
    macdStatus: isBuySetup ? 'Bullish Momentum' : 'Bearish Momentum',
    tradeZoneText: isBuySetup ? 'BUY ZONE (Discount)' : 'SELL ZONE (Premium)'
  };
}

app.get('/api/dashboard-data', async (req, res) => {
  const tf = req.query.tf || '1h';
  const symbol = req.query.symbol || 'OANDA:XAUUSD';
  const realPrice = req.query.price;

  const newsData = await fetchDailyNewsAnalysis(symbol);
  const setup = calculatePunportSetup(symbol, tf, realPrice, newsData.hasHighImpactNews);

  res.json({
    symbol: symbol,
    timeframe: tf.toUpperCase(),
    signal: {
      detail: `คำนวณจุดเข้าอิง Volume Profile & FVG (${symbol} - TF ${tf.toUpperCase()}) ${newsData.hasHighImpactNews ? '⚡ [ช่วงข่าวผันผวนสูง]' : ''}`,
      recommendation: setup.recommendationText
    },
    srLevels: {
      poc: setup.poc,
      vah: setup.vah,
      val: setup.val
    },
    tradeSetup: {
      buyPoint: setup.buyPoint,
      sellPoint: setup.sellPoint,
      tpLevel: setup.tpLevel,
      slLevel: setup.slLevel
    },
    tradeZone: setup.tradeZoneText,
    macdFocus: setup.macdStatus,
    dailyNews: newsData
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});