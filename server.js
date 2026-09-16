const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ฟังก์ชันคำนวณราคาและระดับแนวรับ-แนวต้าน Dynamic ตามสัญลักษณ์และ Timeframe
function calculateDynamicSR(symbol, tf) {
  let basePrice = 2500.00;
  if (symbol.includes('XAG')) basePrice = 30.00;
  if (symbol.includes('USOIL')) basePrice = 75.00;
  if (symbol.includes('BTC')) basePrice = 65000.00;
  if (symbol.includes('SPX')) basePrice = 5500.00;
  if (symbol.includes('AAPL')) basePrice = 220.00;
  if (symbol.includes('PTT')) basePrice = 34.00;

  const randomOffset = (Math.random() - 0.5) * (basePrice * 0.005);
  const currentPrice = basePrice + randomOffset;

  const tfMultiplierMap = { '1m': 0.001, '5m': 0.003, '1h': 0.008, '4h': 0.015, '1d': 0.03 };
  const mult = tfMultiplierMap[tf] || 0.008;

  return {
    price: currentPrice.toFixed(2),
    r2: (currentPrice * (1 + mult * 2)).toFixed(2),
    r1: (currentPrice * (1 + mult)).toFixed(2),
    s1: (currentPrice * (1 - mult)).toFixed(2),
    s2: (currentPrice * (1 - mult * 2)).toFixed(2)
  };
}

// API Endpoint สำหรับส่งข้อมูลไปยังหน้า Dashboard
app.get('/api/dashboard-data', async (req, res) => {
  const tf = req.query.tf || '1h';
  const symbol = req.query.symbol || 'OANDA:XAUUSD';

  const sr = calculateDynamicSR(symbol, tf);

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
      title: 'Gold gains as market eyes Fed interest rate decision & bond yield moves',
      reason: 'ตลาดจับตาดูทิศทางอัตราดอกเบี้ยของ Fed และการย่อตัวของอัตราผลตอบแทนพันธบัตร ช่วยหนุนแรงซื้อทองคำ',
      sentiment: 'positive',
      link: 'https://www.reuters.com/markets/commodities/'
    },
    {
      source: 'FOREX.com',
      title: 'Crude oil, bond yields exert pressure on XAU/USD ahead of FOMC',
      reason: 'การผันผวนของราคาน้ำมันดิบและอัตราผลตอบแทนพันธบัตรส่งผลกดดันราคาทองคำในระยะสั้นก่อนประชุม FOMC',
      sentiment: 'negative',
      link: 'https://www.forex.com/en-us/news-and-analysis/'
    },
    {
      source: 'MarketWatch',
      title: 'Gold settles near key support as dollar and yields keep rising',
      reason: 'ดอลลาร์แข็งค่าและพันธบัตรรัฐบาลปรับตัวสูงขึ้น ทำให้ราคาทองคำลงไปทดสอบบริเวณแนวรับสำคัญ',
      sentiment: 'neutral',
      link: 'https://www.marketwatch.com/investing/future/gold'
    },
    {
      source: 'FXStreet',
      title: 'Gold defends key support zone ahead of monetary policy verdict',
      reason: 'ราคาทองคำยังคงยืนเหนือแนวรับสำคัญได้ดี ขณะที่นักลงทุนรอฟังผลการตัดสินใจนโยบายการเงิน',
      sentiment: 'positive',
      link: 'https://www.fxstreet.com/markets/commodities/gold'
    }
  ];

  res.json({
    symbol: symbol,
    timeframe: tf.toUpperCase(),
    signal: {
      action: `${symbol} — โซนทดสอบราคาสำคัญ ($${sr.price})`,
      detail: `ราคาปัจจุบันเคลื่อนไหวทดสอบกรอบแนวต้าน R1 ($${sr.r1}) และแนวรับ S1 ($${sr.s1})`,
      badge: stochColor === 'positive' ? 'BUY' : stochColor === 'negative' ? 'SELL' : 'NEUTRAL'
    },
    srLevels: {
      r2: sr.r2,
      r1: sr.r1,
      s1: sr.s1,
      s2: sr.s2
    },
    marketTrend: {
      text: 'แกว่งตัวในกรอบสะสมกำลัง (Consolidation) — รอปัจจัยหนุนจากตัวเลขเศรษฐกิจและประชุม Fed',
      status: 'neutral',
      label: 'SIDEWAYS'
    },
    card1Status: stochStatus,
    card1Color: stochColor,
    stochasticRaw: {
      k: kValue,
      trend: kValue > 50 ? 'ฝั่งซื้อคุมเปรียบ' : 'ฝั่งขายคุมเปรียบ'
    },
    smc: {
      zone: 'Discount Zone (โซนได้เปรียบฝั่งซื้อ)',
      structure: 'BOS (Break of Structure - ขาขึ้น)',
      orderBlock: `$${sr.s1} -$$
{sr.s2}`
    },
    news: newsFeed
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});