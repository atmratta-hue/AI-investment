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

// ดึงข่าว RSS Feed
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

// คำนวณจุดเข้าตาม TF อ้างอิง PUNPORT FX & UI ในรูป[cite: 2, 3]
function calculatePunportSetup(symbol, tf, realPrice, hasNews) {
  const currentPrice = parseFloat(realPrice) || 4337.93;
  const spread = symbol.includes('XAU') ? 15.0 : 2.5;

  const res1 = (currentPrice + spread * 0.8).toFixed(2);
  const res2 = (currentPrice + spread * 1.5).toFixed(2);
  const sup1 = (currentPrice - spread * 0.8).toFixed(2);
  const sup2 = (currentPrice - spread * 1.5).toFixed(2);

  const buyPoint1 = (currentPrice - spread * 0.3).toFixed(2);
  const buyPoint2 = (currentPrice - spread * 0.6).toFixed(2);
  const sellPoint1 = (currentPrice + spread * 0.3).toFixed(2);
  const sellPoint2 = (currentPrice + spread * 0.6).toFixed(2);

  const isBuy = currentPrice >= parseFloat(sup1);

  return {
    price: currentPrice.toFixed(2),
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
      ? `รอตั้งรับกวาดสภาพคล่องช่วง Order Block ณ แนว FVG (${buyPoint1} - ${buyPoint2})` 
      : `รอราคาดันขึ้นทดสอบแนว Resistance FVG Zone (${sellPoint1} - ${sellPoint2})`,
    macd: 'Bear Focus',
    tradeZone: isBuy ? 'BUY ZONE (Discount)' : 'SELL ZONE (Premium)',
    bslSsl: `[NY] BSL $${res2} / SSL $${sup2}`
  };
}

app.get('/api/dashboard-data', async (req, res) => {
  const tf = req.query.tf || 'M15';
  const symbol = req.query.symbol || 'OANDA:XAUUSD';
  const realPrice = req.query.price || 4337.93;

  const newsData = await fetchDailyNewsAnalysis(symbol);
  const setup = calculatePunportSetup(symbol, tf, realPrice, newsData.hasHighImpactNews);

  res.json({
    symbol,
    timeframe: tf.toUpperCase(),
    setup,
    news: newsData
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});