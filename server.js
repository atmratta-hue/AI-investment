const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Endpoint สำหรับข่าวสารและบทวิเคราะห์อ้างอิง
app.get('/api/dashboard-data', async (req, res) => {
  const tf = (req.query.tf || '1h').toUpperCase();
  const symbol = req.query.symbol || 'OANDA:XAUUSD';

  const newsFeed = [
    {
      source: 'Reuters',
      title: 'Gold gains as market eyes Fed interest rate decision & bond yield moves',
      reason: 'การคาดการณ์แนวโน้มนโยบายการเงินและอัตราผลตอบแทนพันธบัตรสหรัฐฯ ช่วยหนุนแรงซื้อทองคำในกรอบแนวรับสำคัญ',
      sentiment: 'positive',
      link: 'https://www.reuters.com/markets/commodities/'
    },
    {
      source: 'FOREX.com',
      title: 'Crude oil, bond yields exert pressure on XAU/USD ahead of FOMC',
      reason: 'ความผันผวนของราคาน้ำมันดิบและอัตราผลตอบแทนพันธบัตรส่งผลให้ทองคำเกิดการย่อตัวทดสอบโซน Order Block',
      sentiment: 'negative',
      link: 'https://www.forex.com/en-us/news-and-analysis/'
    },
    {
      source: 'MarketWatch',
      title: 'Gold settles near key support as dollar and yields stabilize',
      reason: 'ดัชนีดอลลาร์ทรงตัวชะลอการขึ้น เปิดโอกาสให้ราคาทองคำเกิดแรงซื้อสะสมบริเวณ Internal Range Liquidity',
      sentiment: 'neutral',
      link: 'https://www.marketwatch.com/investing/future/gold'
    },
    {
      source: 'FXStreet',
      title: 'Gold defends key support zone ahead of monetary policy verdict',
      reason: 'ราคาทองคำยังคงยกฐานยืนเหนือแนวรับสำคัญได้ดี สอดคล้องกับสัญญาณเทคนิคใน Timeframe 1H และ 4H',
      sentiment: 'positive',
      link: 'https://www.fxstreet.com/markets/commodities/gold'
    }
  ];

  res.json({
    symbol: symbol,
    timeframe: tf,
    marketTrend: {
      text: `แนวโน้มหลักใน TF ${tf} — สภาวะแกว่งตัวในกรอบ (Consolidation) รอยืนยันการทะลุผ่านโซน Order Block`,
      status: 'neutral',
      label: 'SIDEWAYS'
    },
    news: newsFeed
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});