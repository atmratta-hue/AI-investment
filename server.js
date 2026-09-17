const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();
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

// คำนวณ Pine Script Order Block & SMC Internal Range Liquidity (IRL)
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

  // === SMC Internal Range Liquidity (IRL) Calculation ===
  // BSL (Buy Side Liquidity) อยู่ช่วง Premium Zone เหนือ EQ (zoneMid)
  // SSL (Sell Side Liquidity) อยู่ช่วง Discount Zone ใต้ EQ (zoneMid)
  const irlBSL = (zoneMid + (zoneHigh - zoneMid) * 0.5).toFixed(config.decimals);
  const irlSSL = (zoneLow + (zoneMid - zoneLow) * 0.5).toFixed(config.decimals);
  const irlEQ  = zoneMid.toFixed(config.decimals);

  let irlStatus = '';
  if (currentPrice > parseFloat(irlBSL)) {
    irlStatus = `ดึงวอลลุ่ม BSL ($${irlBSL}) แล้ว - เสี่ยงโดน Sweep`;
  } else if (currentPrice < parseFloat(irlSSL)) {
    irlStatus = `ดึงวอลลุ่ม SSL ($${irlSSL}) แล้ว - เสี่ยงเกิด Liquidity Grab`;
  } else {
    irlStatus = `วิ่งในกรอบ IRL (EQ: $${irlEQ})`;
  }

  const macdVal = (Math.random() - 0.4) * 5;
  const signalVal = (Math.random() - 0.4) * 4;
  const hist = macdVal - signalVal;

  const isBullFocus = (macdVal > signalVal) && (hist > 0);
  const isBearFocus = (macdVal < signalVal) && (hist < 0);

  let focusSignal = 'NEUTRAL';
  let badgeClass = 'neutral';
  let detailMsg = `ราคาเคลื่อนไหวภายใน Trade Zone ($${zoneLow.toFixed(config.decimals)} - $${zoneHigh.toFixed(config.decimals)})`;

  if (isBuyZone && isBullFocus) {
    focusSignal = 'BUY FOCUS';
    badgeClass = 'buy';
    detailMsg = `เกิดสัญญาณ BUY FOCUS: ราคาอยู่ใน Buy Zone ร่วมกับ MACD Bull Focus และสะสม SSL Liquidity`;
  } else if (isSellZone && isBearFocus) {
    focusSignal = 'SELL FOCUS';
    badgeClass = 'sell';
    detailMsg = `เกิดสัญญาณ SELL FOCUS: ราคาอยู่ใน Sell Zone ร่วมกับ MACD Bear Focus และทดสอบ BSL Liquidity`;
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
    irl: {
      bsl: irlBSL,
      ssl: irlSSL,
      eq: irlEQ,
      summary: `BSL $${irlBSL} / SSL $${irlSSL}`,
      detail: irlStatus
    }
  };
}

// API Data Endpoint สรุปข่าวและคาดการณ์ล่วงหน้าแบบครอบคลุม Real-time
app.get('/api/dashboard-data', (req, res) => {
  const tf = req.query.tf || '1h';
  const symbol = req.query.symbol || 'OANDA:XAUUSD';

  const data = calculatePineScriptOB(symbol, tf);

  // สรุปข่าวครอบคลุมทุกอีเวนต์สำคัญ (FOMC, CPI, NFP, Retail Sales, Fed Speech)
  const newsFeed = [
    {
      type: 'forecast',
      source: 'Forex Factory & Trading Economics',
      title: 'FOMC Interest Rate Decision & Powell Speech (1:00 AM GMT+7)',
      reason: 'คาดการณ์คงอัตราดอกเบี้ย หากแถลงการณ์ส่งสัญญาณ Dovish (ผ่อนคลาย) จะเป็นปัจจัยหนุนทองคำพุ่งขึ้นแรง',
      sentiment: 'positive',
      link: 'https://www.goldsniper.io/calendar/'
    },
    {
      type: 'forecast',
      source: 'Investing.com (Forecast)',
      title: 'US CPI Inflation Data Release (19:30 GMT+7)',
      reason: 'คาดการณ์ 3.1% (ครั้งก่อน 3.2%) หากตัวเลขต่ำกว่าคาด ดอลลาร์จะอ่อนค่าส่งผลบวกต่อฝั่ง BUY',
      sentiment: 'neutral',
      link: 'https://th.investing.com/economic-calendar/'
    },
    {
      type: 'forecast',
      source: 'FXStreet (Analysis)',
      title: 'Non-Farm Payrolls (NFP) & Unemployment Rate Preview',
      reason: 'นักวิเคราะห์ประเมินตลาดแรงงานเริ่มชะลอตัว อาจเร่งให้ Fed พิจารณาลดดอกเบี้ยเร็วขึ้น',
      sentiment: 'positive',
      link: 'https://www.fxstreet.com/analysis/latest'
    },
    {
      type: 'past',
      source: 'Reuters',
      title: 'US Retail Sales & Producer Price Index (PPI) Digest',
      reason: 'ตัวเลขยอดขายปลีกและดัชนี PPI ล่าสุด สะท้อนแรงกดดันเงินเฟ้อระดับขายส่งเริ่มทรงตัว',
      sentiment: 'positive',
      link: 'https://www.reuters.com/markets/commodities/'
    },
    {
      type: 'past',
      source: 'FOREX.com',
      title: 'US Dollar Index (DXY) Stabilizes as Bond Yields Retrace',
      reason: 'บอนด์ยีลด์ย่อตัวลงเมื่อคืนที่ผ่านมา ช่วยลดแรงกดดันในโซน Bearish Order Block',
      sentiment: 'neutral',
      link: 'https://www.forex.com/en-us/news-and-analysis/'
    }
  ];

  const marketState = {
    text: 'Wait & See (ชะลอตัวรอผลประชุม FOMC และแถลงการณ์ประธาน Fed คืนนี้)',
    status: 'neutral',
    label: 'WAIT & SEE',
    catalyst: {
      active: true,
      time: 'คืนนี้ 01:00 น. / พรุ่งนี้ 19:30 น.',
      event: 'ประชุม FOMC, ดัชนี CPI และตัวเลขการจ้างงาน NFP สหรัฐฯ',
      details: '<b>คาดการณ์ตลาด:</b> ตลาดลุ้นสัญญาณปรับลดอัตราดอกเบี้ยจาก Fed หากตัวเลขเงินเฟ้อและ NFP ชะลอตัว จะกระตุ้นแรงซื้อทองคำทดสอบ Zone High'
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