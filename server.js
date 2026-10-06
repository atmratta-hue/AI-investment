const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// กำหนดให้เสิร์ฟไฟล์ Static (เช่น HTML, CSS, JS) จากโฟลเดอร์ปัจจุบัน
app.use(express.static(path.join(__dirname, 'public')));

// เส้นทางหลัก (Route) สำหรับเปิดหน้าเว็บไซต์
app.get('/', (req, res) => {
	res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// เริ่มรัน Server
app.listen(PORT, () => {
	console.log(`=========================================`);
	console.log(`🚀 KU TRADER Server is running successfully!`);
	console.log(`👉 Open your browser at: http://localhost:${PORT}`);
	console.log(`=========================================`);
});
