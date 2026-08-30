# Sanctuary — เว็บจัดตี้

เว็บลงชื่อ + จัดตี้ลง Sanctuary แบบเรียลไทม์

- **เพื่อน** เข้าหน้าแรก `/` ลงชื่อ: ชื่อคนเล่น, ชื่อตัวละคร, CP, คลาส — ลงได้หลายตัว แก้ไข/ลบได้เฉพาะตัวที่ลงจากเครื่องตัวเอง
- **แอดมิน** เข้า `/admin` แล้ว **ลากรายชื่อ** เข้าตี้ให้ครบ 10 คน สร้างได้หลายตี้ (หลายรอบ)
- แต่ละตี้มี **countdown** นับถอยหลังถึงเวลาเริ่มลง
- อัปเดตสด ทุกคนเห็นพร้อมกันผ่าน SSE

## รันเครื่องตัวเอง
```bash
npm install
ADMIN_PASSWORD=yourpass npm start
# เปิด http://localhost:3000  และ  http://localhost:3000/admin
```

## Deploy บน Railway (ผ่าน GitHub)
1. push โฟลเดอร์นี้ขึ้น GitHub repo
2. Railway → New Project → Deploy from GitHub repo → เลือก repo
3. ไปที่ **Variables** ตั้งค่า:
   - `ADMIN_PASSWORD` = รหัสผ่านแอดมินของคุณ (สำคัญ)
   - `DATA_DIR` = `/data` (ถ้าจะเก็บข้อมูลถาวร ดูข้อ 4)
4. (แนะนำ) กด **+ Volume** mount ที่ `/data` เพื่อให้ข้อมูลไม่หายเวลา redeploy
5. Railway จะรัน `npm start` เอง (ใช้ `PORT` ที่ระบบให้มา)

> ถ้าไม่ตั้ง `ADMIN_PASSWORD` จะใช้ค่า default `admin1234` — ควรเปลี่ยน

## โครงสร้าง
```
server.js          Express + SQLite + SSE
public/index.html  หน้าลงชื่อ (เพื่อน)
public/admin.html  หน้าแอดมิน (ลากจัดตี้)
public/*.js/.css   ฝั่งหน้าเว็บ
```
