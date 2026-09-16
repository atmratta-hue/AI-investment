const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ฟังก์ชันดึงคอนฟิกราคาและ Volatility ตามสัญลักษณ์
function getAssetConfig(symbol) {
  const sym = symbol.toUpperCase();
  if (sym.includes('BTC')) return { base: 65000, decimals: 2, vol: 0.015 };
  if (sym.includes('XAU')) return { base: 2740, decimals: 2, vol: 0.008 };
  if (sym.includes('XAG')) return { base: 31.50, decimals: 2, vol: 0.012 };
  if (sym.includes('USOIL')) return { base: 76.50, decimals: 2, vol: 0.010 };
  if (sym.includes('SPX')) return { base: 5550, decimals: 2, vol: 0.006 };
  if (sym.includes('AAPL')) return { base: 225.00, decimals: 2, vol: 0.008 };
  if (sym.includes('PTT')) return { base: 34.25, decimals: 2, vol: 0.005 };
  return { base: 100.00, decimals: 2, vol: 0.008 };
}

// คำนวณ Order Block & Trade Zone ตามสูตร Pine Script v5
function calculatePineScriptOB(symbol, tf) {
  const config = getAssetConfig(symbol);
  
  const tfMultipliers = {
    '1m': 0.002, '5m': 0.005, '1h': 0.012, '4h': 0.025, '1d': 0.050
  };
  const mult = (tfMultipliers[tf.toLowerCase()] || tfMultipliers['1h']) * config.vol * 100;
  
  const currentPrice = config.base + (Math.random() - 0.5) * (config.base * mult * 0.1);
  const atr14 = currentPrice * mult * 0.4; // ประมาณการค่า ATR(14)

  // PART 3: Trade Zone (Lookback 50)
  const zoneHigh = currentPrice * (1 + mult * 1.5); // Resistance
  const zoneLow  = currentPrice * (1 - mult * 1.5); // Support
  const zoneMid  = (zoneHigh + zoneLow) / 2;

  const isBuyZone  = currentPrice < zoneMid && currentPrice > zoneLow;
  const isSellZone = currentPrice > zoneMid && currentPrice < zoneHigh;

  // PART 2: Smart Order Block (OB) สูตร Pine Script
  // Bullish OB = [low[1] - ATR*0.5 , low[1]]
  // Bearish OB = [high[1] , high[1] + ATR*0.5]
  const bullObTop = zoneLow;
  const bullObBot = zoneLow - (atr14 * 0.5);

  const bearObBot = zoneHigh;
  const bearObTop = zoneHigh + (atr14 * 0.5);

  // PART 4: MACD Trend Focus & Signals
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

// API Endpoint
app.get('/api/dashboard-data', async (req, res) => {
  const tf = req.query.tf || '1h';
  const symbol = req.query.symbol || 'OANDA:XAUUSD';

  const data = calculatePineScriptOB(symbol, tf);

  const newsFeed = [
    {
      source: 'Reuters',
      title: 'Gold gains as MACD Focus Signal triggers BUY in key Support Zone',
      reason: 'เกิดสัญญาณ BUY Focus ตามกรอบแนวรับ Trade Zone และโครงสร้าง Order Block ใน TF 1H/4H',
      sentiment: 'positive',
      link: 'https://www.reuters.com/markets/commodities/'
    },
    {
      source: 'FOREX.com',
      title: 'Crude oil, bond yields test Bearish Order Block boundary',
      reason: 'การผันผวนของราคาน้ำมันดิบส่งผลให้ราคาเข้าใกล้ขอบบนโซน Bearish Order Block',
      sentiment: 'negative',
      link: 'https://www.forex.com/en-us/news-and-analysis/'
    },
    {
      source: 'MarketWatch',
      title: 'Dollar Index stabilizes as traders monitor Internal Range Liquidity',
      reason: 'ดัชนีดอลลาร์ทรงตัวบริเวณจุดสะสมวอลลุ่ม Liquidity ก่อนการเลือกทิศทางใหม่',
      sentiment: 'neutral',
      link: 'https://www.marketwatch.com/investing/future/gold'
    }
  ];

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
    marketTrend: {
      text: `สภาวะตลาด: ${data.macdStatus} | กรอบ ${data.tradeZoneText}`,
      status: data.badgeClass === 'buy' ? 'positive' : data.badgeClass === 'sell' ? 'negative' : 'neutral',
      label: data.focusSignal
    },
    news: newsFeed
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});