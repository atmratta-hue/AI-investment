const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 1. ลองดึงจากโฟลเดอร์ public ก่อน
app.use(express.static(path.join(__dirname, 'public')));

// 2. ป้องกันปัญหา Cannot GET / (ดึงไฟล์ index.html ไม่ว่าจะอยู่ข้างนอกหรือใน public)
app.get('/', (req, res) => {
  const publicIndexPath = path.join(__dirname, 'public', 'index.html');
  const rootIndexPath = path.join(__dirname, 'index.html');

  if (fs.existsSync(publicIndexPath)) {
    res.sendFile(publicIndexPath);
  } else if (fs.existsSync(rootIndexPath)) {
    res.sendFile(rootIndexPath);
  } else {
    res.status(404).send('<h2>ไม่พบไฟล์ index.html! โปรดตรวจสอบว่ามีไฟล์ index.html อยู่ในโฟลเดอร์โครงการหรือไม่</h2>');
  }
});

// ฟังก์ชันดึงคอนฟิกราคา
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

function calculatePineScriptOB(symbol, tf) {
  const config = getAssetConfig(symbol);
  const tfMultipliers = { '1m': 0.002, '5m': 0.005, '1h': 0.012, '4h': 0.025, '1d': 0.050 };
  const mult = (tfMultipliers[(tf || '1h').toLowerCase()] || tfMultipliers['1h']) * config.vol * 100;
  
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

  const macdVal = (Math.random() - 0.4) * 5;
  const signalVal = (Math.random() - 0.4) * 4;
  const hist = macdVal - signalVal;

  const isBullFocus = (macdVal > signalVal) && (hist > 0);
  const isBearFocus = (macdVal < signalVal) && (hist < 0);

  let focusSignal = 'NEUTRAL';
  let badgeClass = 'neutral';
  let detailMsg = `ราคากำลังวิ่งอยู่ในกรอบ Trade Zone ($${zoneLow.toFixed(config.decimals)} - $${zoneHigh.toFixed(config.decimals)})`;

  if (isBuyZone && isBullFocus) {
    focusSignal = 'BUY FOCUS';
    badgeClass = 'buy';
    detailMsg = `เกิดสัญญาณ BUY FOCUS: ราคาอยู่ใน Buy Zone ร่วมกับ MACD Bull Focus (ทดสอบ Bullish OB)`;
  } else if (isSellZone && isBearFocus) {
    focusSignal = 'SELL FOCUS';
    badgeClass = 'sell';
    detailMsg = `เกิดสัญญาณ SELL FOCUS: ราคาอยู่ใน Sell Zone ร่วมกับ MACD Bear Focus (ทดสอบ Bearish OB)`;
  }

  return {
    price: currentPrice.toFixed(config.decimals),
    zoneHigh: zoneHigh.toFixed(config.decimals),
    zoneLow: zoneLow.toFixed(config.decimals),
    zoneMid: zoneMid.toFixed(config.decimals),
    tradeZoneText: isBuyZone ? 'BUY ZONE (โซนฝั่งซื้อ)' : isSellZone ? 'SELL ZONE (โซนฝั่งขาย)' : 'MID ZONE',
    bullishOB: `$${bullObBot.toFixed(config.decimals)} - $${bullObTop.toFixed(config.decimals)}`,
    bearishOB: `$${bearObBot.toFixed(config.decimals)} - $${bearObTop.toFixed(config.decimals)}`,
    macdStatus: isBullFocus ? 'Bull Focus (เขียว)' : isBearFocus ? 'Bear Focus (แดง)' : 'SideFocus',
    focusSignal: focusSignal,
    badgeClass: badgeClass,
    detailMessage: detailMsg,
    irl: {
      bsl: (currentPrice + (zoneHigh - currentPrice) * 0.5).toFixed(config.decimals),
      ssl: (currentPrice - (currentPrice - zoneLow) * 0.5).toFixed(config.decimals)
    }
  };
}

// API Data Endpoint
app.get('/api/dashboard-data', (req, res) => {
  const tf = req.query.tf || '1h';
  const symbol = req.query.symbol || 'OANDA:XAUUSD';

  const data = calculatePineScriptOB(symbol, tf);

  const newsFeed = [
    {
      type: 'forecast',
      source: 'Forex Factory (Forecast)',
      title: 'US CPI Release at 19:30 GMT+7',
      reason: 'คาดการณ์ 3.1% (ครั้งก่อน 3.2%) หากตัวเลขต่ำกว่าคาด สินทรัพย์มีความเสี่ยงพุ่งขึ้นทดสอบ Zone High',
      sentiment: 'neutral',
      link: '#'
    },
    {
      type: 'past',
      source: 'Reuters',
      title: 'Gold gains as MACD Focus Signal triggers BUY in key Support Zone',
      reason: 'แรงซื้อเก็งกำไรดันราคากลับขึ้นมายืนเหนือกรอบแนวรับสำคัญใน 24 ชั่วโมงที่ผ่านมา',
      sentiment: 'positive',
      link: 'https://www.reuters.com/markets/commodities/'
    },
    {
      type: 'forecast',
      source: 'MarketWatch (Forecast)',
      title: 'FED Rate Decision & FOMC Statement Tomorrow',
      reason: 'นักวิเคราะห์เก็งว่า FED จะคงอัตราดอกเบี้ย ส่งผลให้ดอลลาร์อาจชะลอตัว เป็นปัจจัยหนุนฝั่งซื้อ (Bullish Expectation)',
      sentiment: 'positive',
      link: 'https://www.marketwatch.com/investing/future/gold'
    },
    {
      type: 'past',
      source: 'FOREX.com',
      title: 'Crude oil, bond yields test Bearish Order Block boundary',
      reason: 'เมื่อคืนที่ผ่านมา ตลาดถูกกดดันจากการปรับขึ้นของบอนด์ยีลด์',
      sentiment: 'negative',
      link: 'https://www.forex.com/en-us/news-and-analysis/'
    }
  ];

  const marketState = {
    text: 'Wait & See (ชะลอตัวเพื่อรอตัวเลขเงินเฟ้อ CPI สหรัฐฯ คืนนี้)',
    status: 'neutral',
    label: 'WAIT & SEE',
    catalyst: {
      active: true,
      time: 'คืนนี้ 19:30 น.',
      event: 'ประกาศตัวเลขดัชนีราคาผู้บริโภค (CPI) สหรัฐฯ',
      details: 'คาดการณ์: 3.1% (ครั้งก่อน 3.2%)<br><b>Impact Forecast:</b> หากเงินเฟ้อต่ำกว่าคาด ดอลลาร์จะอ่อนค่า หนุนให้ราคาทองคำทะลุขึ้น'
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
    news: newsFeed
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});