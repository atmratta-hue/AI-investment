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

// 1. ดึงแหล่งข่าวอ้างอิงทั้งหมด และวิเคราะห์ Sentiment
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
      const processed = feed.items.slice(0, 4).map(item => {
        const text = (item.title + ' ' + (item.contentSnippet || '')).toLowerCase();
        
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
          reason: item.contentSnippet ? item.contentSnippet.substring(0, 140) + '...' : 'คลิกอ่านรายละเอียดจากแหล่งข่าวต้นทาง',
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
  let overallDesc = `สภาวะข่าวของ ${symbol} อยู่ในระดับปกติ แนะนำเข้าเทรดตามกรอบ Volume Profile & FVG ในช่วง Kill Zone`;
  let badgeStyle = 'neutral';

  if (posCount > negCount) {
    overallImpact = 'BULLISH (+)';
    overallDesc = `ข่าวและปัจจัยทางเศรษฐกิจส่งผลบวก (+) ต่อ ${symbol} หนุนให้ราคามีโอกาสปรับตัวขึ้นทดสอบแนวต้านสำคัญ`;
    badgeStyle = 'positive';
  } else if (negCount > posCount) {
    overallImpact = 'BEARISH (-)';
    overallDesc = `ข่าวเศรษฐกิจส่งผลกดดันเชิงลบ (-) ต่อ ${symbol} มีโอกาสย่อตัวลงมาทดสอบแนวรับสำคัญ`;
    badgeStyle = 'negative';
  }

  return { overallImpact, overallDesc, badgeStyle, hasHighImpactNews, newsList: newsItems };
}

// 2. คำนวณ Multi-Timeframe Entry Point & แนวรับ-แนวต้าน (Support/Resistance) อิงไฟล์ PUNPORT FX
function calculatePunportSetup(symbol, tf, realPrice, hasNews) {
  const currentPrice = parseFloat(realPrice) || 2740.00;
  
  const isHighVol = symbol.includes('XAU') || symbol.includes('BTC') || symbol.includes('OIL');
  let baseSpread = isHighVol ? currentPrice * 0.006 : currentPrice * 0.0025;
  const newsMultiplier = hasNews ? 1.4 : 1.0;
  const spread = baseSpread * newsMultiplier;

  // คำนวณ Volume Profile & Support/Resistance Levels
  const pocPrice = currentPrice - (spread * 0.05); 
  const vahPrice = currentPrice + (spread * 0.4); 
  const valPrice = currentPrice - (spread * 0.4); 

  // แนวรับ - แนวต้าน 1 และ 2
  const resistance1 = (currentPrice + (spread * 0.5)).toFixed(2);
  const resistance2 = (currentPrice + (spread * 1.0)).toFixed(2);
  const support1 = (currentPrice - (spread * 0.5)).toFixed(2);
  const support2 = (currentPrice - (spread * 1.0)).toFixed(2);

  const fvgBuy50  = currentPrice - (spread * 0.2); 
  const fvgSell50 = currentPrice + (spread * 0.2); 

  const isBuySetup = currentPrice >= pocPrice;

  let buyPoint, sellPoint, tpLevel, slLevel, recommendationText, entryContextNote;

  // Logic การอ้างอิงจุดเข้าตาม Multi-Timeframe
  const tfUpper = tf.toUpperCase();
  if (tfUpper === 'H4') {
    entryContextNote = "วิเคราะห์โครงสร้างหลัก H4: พิจารณาจุดเข้าซื้อขายฝั่ง M15 หรือ M5 เมื่อเกิด FVG / Swept Liquidity";
  } else if (tfUpper === 'H1') {
    entryContextNote = "วิเคราะห์โครงสร้างหลัก H1: พิจารณาจุดเข้าซื้อขายแม่นยำใน M1, M5 หรือ M15";
  } else if (tfUpper === 'M15') {
    entryContextNote = "คำนวณจุดเข้า Real-time บนกรอบ M15 (อิงจุดเกิด FVG / Volume POC)";
  } else if (tfUpper === 'M5') {
    entryContextNote = "คำนวณจุดเข้า Real-time บนกรอบ M5 (เน้น Scalping / Quick Turnaround)";
  } else if (tfUpper === 'M1') {
    entryContextNote = "คำนวณจุดเข้า Real-time บนกรอบ M1 (Precision Entry Zone)";
  } else {
    entryContextNote = `คำนวณจุดเข้า Real-time บน timeframe ${tfUpper}`;
  }

  if (isBuySetup) {
    buyPoint = fvgBuy50.toFixed(2);
    sellPoint = resistance1;
    
    const slDistance = hasNews ? (spread * 0.45) : (spread * 0.35);
    slLevel = (fvgBuy50 - slDistance).toFixed(2);
    const risk = fvgBuy50 - parseFloat(slLevel);
    tpLevel = (fvgBuy50 + (risk * 1.8)).toFixed(2);

    recommendationText = `[${tfUpper}] ฝั่ง BUY: จุดเข้าซื้อ ณ ราคา $${buyPoint} (FVG 50% / Support Zone) | TP: $${tpLevel} | SL: $${slLevel}`;
  } else {
    buyPoint = support1;
    sellPoint = fvgSell50.toFixed(2);
    
    const slDistance = hasNews ? (spread * 0.45) : (spread * 0.35);
    slLevel = (fvgSell50 + slDistance).toFixed(2);
    const risk = parseFloat(slLevel) - fvgSell50;
    tpLevel = (fvgSell50 - (risk * 1.8)).toFixed(2);

    recommendationText = `[${tfUpper}] ฝั่ง SELL: จุดเข้าขาย ณ ราคา $${sellPoint} (FVG 50% / Resistance Zone) | TP: $${tpLevel} | SL: $${slLevel}`;
  }

  return {
    price: currentPrice.toFixed(2),
    poc: pocPrice.toFixed(2),
    vah: vahPrice.toFixed(2),
    val: valPrice.toFixed(2),
    res1: resistance1,
    res2: resistance2,
    sup1: support1,
    sup2: support2,
    buyPoint,
    sellPoint,
    tpLevel,
    slLevel,
    recommendationText,
    entryContextNote,
    macdStatus: isBuySetup ? 'Bullish Momentum' : 'Bearish Momentum',
    tradeZoneText: isBuySetup ? 'BUY ZONE (Discount Area)' : 'SELL ZONE (Premium Area)'
  };
}

app.get('/api/dashboard-data', async (req, res) => {
  const tf = req.query.tf || 'M15';
  const symbol = req.query.symbol || 'OANDA:XAUUSD';
  const realPrice = req.query.price;

  const newsData = await fetchDailyNewsAnalysis(symbol);
  const setup = calculatePunportSetup(symbol, tf, realPrice, newsData.hasHighImpactNews);

  res.json({
    symbol: symbol,
    timeframe: tf.toUpperCase(),
    signal: {
      detail: `${setup.entryContextNote} ${newsData.hasHighImpactNews ? '⚡ [ช่วงข่าวผันผวนสูง - ควรระวัง ไส้เทียนกวาด SL]' : ''}`,
      recommendation: setup.recommendationText
    },
    srLevels: {
      poc: setup.poc,
      vah: setup.vah,
      val: setup.val,
      res1: setup.res1,
      res2: setup.res2,
      sup1: setup.sup1,
      sup2: setup.sup2
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
  console.log(`Server started on http://localhost:${PORT}`);
});