const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ฐานราคาอ้างอิงและทศนิยมตามแต่ละ Asset
function getAssetConfig(symbol) {
  const sym = symbol.toUpperCase();
  if (sym.includes('BTC')) return { base: 65000, decimals: 2, vol: 0.015 };
  if (sym.includes('XAU')) return { base: 2500, decimals: 2, vol: 0.008 };
  if (sym.includes('XAG')) return { base: 30.50, decimals: 2, vol: 0.012 };
  if (sym.includes('USOIL')) return { base: 76.50, decimals: 2, vol: 0.010 };
  if (sym.includes('SPX')) return { base: 5550, decimals: 2, vol: 0.006 };
  if (sym.includes('AAPL')) return { base: 225.00, decimals: 2, vol: 0.008 };
  if (sym.includes('PTT')) return { base: 34.25, decimals: 2, vol: 0.005 };
  
  return { base: 100.00, decimals: 2, vol: 0.008 };
}

// คำนวณโครงสร้าง SMC, Order Block และ Internal Range Liquidity ตาม TF
function calculateSMCandLiquidity(symbol, tf) {
  const config = getAssetConfig(symbol);
  
  // ปรับ Multiplier ตาม TF โดยเน้น 1h และ 4h เป็นหลัก
  const tfMultipliers = {
    '1m': 0.0015,
    '5m': 0.0035,
    '1h': 0.0100,  // TF หลัก 1 ชั่วโมง
    '4h': 0.0220,  // TF หลัก 4 ชั่วโมง
    '1d': 0.0450
  };

  const mult = (tfMultipliers[tf.toLowerCase()] || tfMultipliers['1h']) * config.vol * 100;
  
  // สุ่มการแกว่งตัวจำลองการเทรดแบบ Real-time
  const noise = (Math.random() - 0.5) * (config.base * mult * 0.2);
  const currentPrice = config.base + noise;

  // แนวรับ - แนวต้าน Macro (S/R)
  const r2 = currentPrice * (1 + mult * 1.8);
  const r1 = currentPrice * (1 + mult * 0.9);
  const s1 = currentPrice * (1 - mult * 0.9);
  const s2 = currentPrice * (1 - mult * 1.8);

  // คำนวณ Order Block (OB Zone)
  const bullishOB_low = (s1 * 0.998).toFixed(config.decimals);
  const bullishOB_high = (s1 * 1.002).toFixed(config.decimals);
  const bearishOB_low = (r1 * 0.998).toFixed(config.decimals);
  const bearishOB_high = (r1 * 1.002).toFixed(config.decimals);

  // คำนวณ Internal Range Liquidity (IRL - แนวรับแนวต้านย่อยก่อนกราฟเลือกทาง)
  const irl_bsl = (currentPrice + (r1 - currentPrice) * 0.45).toFixed(config.decimals); // Buy-side Liquidity ย่อย
  const irl_ssl = (currentPrice - (currentPrice - s1) * 0.45).toFixed(config.decimals); // Sell-side Liquidity ย่อย

  // คำนวณ SMC Premium / Discount Zone
  const rangeMid = (r1 + s1) / 2;
  const isDiscount = currentPrice < rangeMid;
  const smcZoneText = isDiscount ? 'Discount Zone (โซนได้เปรียบฝั่งซื้อ)' : 'Premium Zone (โซนได้เปรียบฝั่งขาย)';

  // แนะนำคำสั่งเทรดตามตำแหน่งราคาต่อ Order Block
  let actionSignal = 'NEUTRAL';
  let detailMessage = '';
  let obRecommendation = '';

  if (currentPrice <= s1 * 1.003) {
    actionSignal = 'BUY';
    detailMessage = `ราคาลงมาทดสอบ Bullish Order Block ในโซน Discount ($${bullishOB_low} - $${bullishOB_high})`;
    obRecommendation = `แนะนำเข้า BUY ที่โซน Bullish OB ($${bullishOB_low} - $${bullishOB_high}) | SL: Below $${s2.toFixed(config.decimals)}`;
  } else if (currentPrice >= r1 * 0.997) {
    actionSignal = 'SELL';
    detailMessage = `ราคาขึ้นมาทดสอบ Bearish Order Block ในโซน Premium ($${bearishOB_low} - $${bearishOB_high})`;
    obRecommendation = `แนะนำเข้า SELL ที่โซน Bearish OB ($${bearishOB_low} - $${bearishOB_high}) | SL: Above $${r2.toFixed(config.decimals)}`;
  } else {
    actionSignal = 'NEUTRAL';
    detailMessage = `ราคากำลังวิ่งอยู่กลางกรอบ ระหว่าง IRL SSL ($${irl_ssl}) และ IRL BSL ($${irl_bsl})`;
    obRecommendation = `รอราคาย่อทดสอบ Bullish OB ($${bullishOB_low}) หรือขึ้นทดสอบ Bearish OB ($${bearishOB_high})`;
  }

  return {
    price: currentPrice.toFixed(config.decimals),
    r2: r2.toFixed(config.decimals),
    r1: r1.toFixed(config.decimals),
    s1: s1.toFixed(config.decimals),
    s2: s2.toFixed(config.decimals),
    smcZone: smcZoneText,
    actionSignal: actionSignal,
    detailMessage: detailMessage,
    obRecommendation: obRecommendation,
    bullishOB: `$${bullishOB_low} - $${bullishOB_high}`,
    bearishOB: `$${bearishOB_low} - $${bearishOB_high}`,
    irl: {
      bsl: irl_bsl,
      ssl: irl_ssl,
      summary: `BSL: $${irl_bsl} | SSL: $${irl_ssl}`
    }
  };
}

// API Endpoint
app.get('/api/dashboard-data', async (req, res) => {
  const tf = req.query.tf || '1h';
  const symbol = req.query.symbol || 'OANDA:XAUUSD';

  const smcData = calculateSMCandLiquidity(symbol, tf);

  const kValue = (Math.random() * 100).toFixed(1);
  let stochStatus = 'Neutral (พักตัวสะสมพลัง)';
  let stochColor = 'neutral';
  
  if (kValue > 80) {
    stochStatus = 'Overbought (ระวังแรงเทขาย)';
    stochColor = 'negative';
  } else if (kValue < 20) {
    stochStatus = 'Oversold (มีโอกาสเกิดการดีดตัว)';
    stochColor = 'positive';
  }

  const newsFeed = [
    {
      source: 'Reuters',
      title: 'Market Eyes Key Order Block Zones Ahead of Central Bank Policy Updates',
      reason: 'นักลงทุนสถาบันเข้าช้อนซื้อบริเวณ Order Block สอดคล้องกับโครงสร้างราคาใน TF 1H และ 4H',
      sentiment: 'positive',
      link: 'https://www.reuters.com/markets/'
    },
    {
      source: 'FXStreet',
      title: 'Technical Analysis: Price Sweeps Internal Range Liquidity Before Breakout',
      reason: 'ราคากำลังกวาด สภาพคล่องย่อย (Internal Liquidity) เพื่อสะสมวอลลุ่มก่อนเลือกทิศทางใหญ่',
      sentiment: 'neutral',
      link: 'https://www.fxstreet.com/'
    }
  ];

  res.json({
    symbol: symbol,
    timeframe: tf.toUpperCase(),
    price: smcData.price,
    signal: {
      action: `${symbol} — $${smcData.price}`,
      detail: smcData.detailMessage,
      badge: smcData.actionSignal,
      obRecommendation: smcData.obRecommendation
    },
    srLevels: {
      r2: smcData.r2,
      r1: smcData.r1,
      s1: smcData.s1,
      s2: smcData.s2
    },
    marketTrend: {
      text: `แนวโน้มเน้นกรอบ TF ${tf.toUpperCase()} — รอยืนยันการทะลุ Internal Liquidity`,
      status: smcData.actionSignal === 'BUY' ? 'positive' : smcData.actionSignal === 'SELL' ? 'negative' : 'neutral',
      label: smcData.actionSignal
    },
    card1Status: stochStatus,
    card1Color: stochColor,
    stochasticRaw: {
      k: kValue,
      trend: kValue > 50 ? 'ฝั่งซื้อคุมเปรียบ' : 'ฝั่งขายคุมเปรียบ'
    },
    smc: {
      zone: smcData.smcZone,
      bullishOB: smcData.bullishOB,
      bearishOB: smcData.bearishOB,
      irl: smcData.irl
    },
    news: newsFeed
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});