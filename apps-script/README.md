# เชื่อมเว็บไซต์ IQA กับ Google Sheets และล็อกอินด้วยบัญชีโรงเรียน

เว็บไซต์ (GitHub Pages) ใช้ปุ่ม **Sign in with Google** เพื่อยืนยันตัวตน แล้วเรียก **Apps Script Web App** ซึ่งตรวจโทเคนกับ Google
ตรวจว่าเป็นบัญชี `@pcccr.ac.th` ตรวจสิทธิ์ตามบทบาท แล้วจึงอ่าน/เขียน **Google Sheet** ของโรงเรียน

```
เบราว์เซอร์ (github.io) ──Sign in with Google──▶ ได้ ID token
      │  POST {idToken, action}
      ▼
Apps Script Web App ──ตรวจ token กับ Google + โดเมน + บทบาท──▶ Google Sheet (Users / Evidence / Results / Assessments / Years / Config / Log)
```

ใช้เวลาตั้งค่าประมาณ 20–30 นาที ต้องใช้บัญชี Google ของโรงเรียน ทำ 5 ขั้นตอนตามลำดับ

---

## ขั้นที่ 1 สร้าง Google Sheet และวางโค้ด

1. ล็อกอินด้วยบัญชีโรงเรียน สร้าง Google Sheet ใหม่ ตั้งชื่อเช่น `IQA-ฐานข้อมูล-2569`
   (แนะนำให้สร้างใน Shared drive ของงานประกันคุณภาพ เพื่อไม่ผูกกับบัญชีคนเดียว)
2. เมนู **ส่วนขยาย → Apps Script**
3. ลบโค้ดเดิมในไฟล์ `Code.gs` แล้ววางเนื้อหาจากไฟล์ [`Code.gs`](Code.gs) ทั้งหมด
4. (แนะนำ) ที่ **การตั้งค่าโปรเจกต์ (⚙)** ติ๊ก "แสดงไฟล์ manifest appsscript.json" แล้ววางเนื้อหาจาก [`appsscript.json`](appsscript.json)
5. เลือกฟังก์ชัน `setup` ที่แถบด้านบน แล้วกด **เรียกใช้** → อนุญาตสิทธิ์ตามที่ Google ถาม
   - ระบบจะสร้างชีต `Users`, `Evidence`, `Results`, `Assessments`, `Years`, `Config`, `Log`
   - `Years` และ `Config` เก็บค่าตั้งค่ารายปีจากหน้า "หลังบ้าน" (อย่าแก้ในชีตโดยตรง ให้แก้ผ่านหน้าหลังบ้าน)
   - และเพิ่มบัญชีของคุณเป็น **admin** ในชีต `Users`

## ขั้นที่ 2 สร้าง OAuth Client ID (สำหรับปุ่ม Sign in with Google)

1. เปิด <https://console.cloud.google.com/> ด้วยบัญชีโรงเรียน → สร้างโปรเจกต์ใหม่ เช่น `pcshscr-iqa`
2. **APIs & Services → OAuth consent screen** (หรือ **Google Auth Platform → Branding**)
   - User type: **Internal** (เฉพาะคนในโดเมนโรงเรียน)
   - กรอกชื่อแอป เช่น "ระบบประกันคุณภาพภายใน" และอีเมลติดต่อ
3. **Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - **Authorized JavaScript origins** เพิ่ม:
     - `https://chanok109.github.io`
     - `http://localhost:8000` (ถ้าต้องการทดสอบในเครื่อง)
   - ไม่ต้องใส่ Redirect URI
4. คัดลอก **Client ID** (ลงท้ายด้วย `.apps.googleusercontent.com`)

> ถ้าเมนูเหล่านี้ถูกล็อก ให้ผู้ดูแล Google Workspace ของโรงเรียนอนุญาตการสร้างโปรเจกต์ Google Cloud

## ขั้นที่ 3 ตั้งค่า Script Properties

ใน Apps Script → **การตั้งค่าโปรเจกต์ (⚙) → Script Properties** เพิ่ม:

| Property | ค่า |
|---|---|
| `CLIENT_ID` | Client ID จากขั้นที่ 2 |
| `ALLOWED_DOMAIN` | `pcccr.ac.th` |
| `ACADEMIC_YEAR` | `2569` ปีตั้งต้น ใช้เมื่อคำขอไม่ระบุปี (สร้างให้อัตโนมัติจาก `setup`) |
| `DEFAULT_ROLE` | `teacher` หรือ `viewer` — บทบาทของบัญชีโรงเรียนที่ไม่มีชื่อในชีต `Users` |

## ขั้นที่ 4 Deploy เป็น Web App

1. Apps Script → **Deploy → New deployment** → ประเภท **Web app**
2. ตั้งค่า:
   - **Execute as:** Me (บัญชีของคุณ)
   - **Who has access:** **Anyone**
3. กด Deploy แล้วคัดลอก **Web app URL** (ลงท้ายด้วย `/exec`)

> **ทำไมต้องเลือก Anyone?** เว็บไซต์อยู่บน github.io ซึ่งเรียก Apps Script ข้ามโดเมน ถ้าจำกัดเฉพาะโดเมน เบราว์เซอร์จะเรียกไม่ได้
> ความปลอดภัยไม่ได้ลดลง เพราะทุกคำขอต้องแนบ Google ID token ที่โค้ดตรวจกับ Google ทุกครั้ง (ต้องออกให้ Client ID นี้ และต้องเป็นบัญชี `@pcccr.ac.th`) คำขอที่ไม่มีโทเคนถูกปฏิเสธ
>
> ถ้าไม่มีตัวเลือก **Anyone** แปลว่าผู้ดูแล Google Workspace ปิดการแชร์ Web App ออกนอกโดเมนไว้ — ต้องให้ผู้ดูแลเปิดให้ หรือเปลี่ยนไปรันเว็บบน Apps Script โดยตรงแทน GitHub Pages

**เมื่อแก้ `Code.gs` ภายหลัง:** Deploy → Manage deployments → ✏ แก้ไข → Version: **New version** → Deploy (URL เดิมใช้ต่อได้)

## ขั้นที่ 5 ใส่ค่าในเว็บไซต์

แก้ไฟล์ `site/assets/js/config.js` แล้ว push เข้า `main` (GitHub Pages จะอัปเดตเองภายใน ~1 นาที)

```js
window.IQA_CONFIG = {
  apiUrl: "https://script.google.com/macros/s/XXXXXXXX/exec",
  googleClientId: "1234567890-xxxx.apps.googleusercontent.com",
  allowedDomain: "pcccr.ac.th",
};
```

ค่าทั้งสองนี้ **ไม่ใช่ความลับ** (เบราว์เซอร์ของผู้ใช้ทุกคนต้องเห็นอยู่แล้ว) จึงเก็บใน repo ได้

---

## ข้อมูลแยกตามปีการศึกษา

- ผลการประเมินในชีต `Results` และ `Assessments` เก็บเป็นคีย์ `ปี:รหัส` เช่น `2569:1.1.1#0` รหัสหลักฐานขึ้นต้นด้วยปี เช่น `2569-1.1.3-D-001`
- ค่าตั้งค่ารายปีอ่านได้โดยไม่ต้องล็อกอิน (เป็นข้อมูลเดียวกับที่ประกาศต่อสาธารณะ) แต่บันทึก ตั้งปีปัจจุบัน และลบได้เฉพาะ `admin`
- ปีการศึกษาแรกที่บันทึกจากหน้าหลังบ้านจะเป็นปีปัจจุบันโดยอัตโนมัติ

## การจัดการผู้ใช้และสิทธิ์

แก้ในชีต `Users` โดยตรง (ไม่ต้อง deploy ใหม่):

| คอลัมน์ | ความหมาย |
|---|---|
| `email` | อีเมลโรงเรียน |
| `name` | ชื่อที่แสดง (เว้นว่างเพื่อใช้ชื่อจากบัญชี Google) |
| `role` | `admin` / `evaluator` / `teacher` / `viewer` |
| `unit` | กลุ่มสาระ/งาน (ไม่บังคับ) |
| `active` | `FALSE` เพื่อระงับการใช้งาน |

| บทบาท | ดูข้อมูล | บันทึกหลักฐาน | ลบหลักฐาน | บันทึกผล/ตัดสินระดับ | นำเข้า/ล้างข้อมูล |
|---|:-:|:-:|:-:|:-:|:-:|
| admin | ✓ | ✓ | ทุกรายการ | ✓ | ✓ |
| evaluator | ✓ | ✓ | ของตนเอง | ✓ | |
| teacher | ✓ | ✓ | ของตนเอง | | |
| viewer | ✓ | | | | |

บัญชี `@pcccr.ac.th` ที่ไม่มีในชีต `Users` จะได้บทบาทตาม `DEFAULT_ROLE` บัญชีนอกโดเมนเข้าไม่ได้

## ความปลอดภัยและข้อมูล

- ตรวจโทเคนกับ Google ทุกคำขอ (แคชผลไว้ไม่เกินอายุโทเคน) — ตรวจ `aud`, `hd`, อีเมลยืนยันแล้ว และวันหมดอายุ
- ตรวจสิทธิ์ที่ฝั่งเซิร์ฟเวอร์ ไม่ได้พึ่งการซ่อนปุ่มในหน้าเว็บ
- ข้อความที่ขึ้นต้นด้วย `= + - @` ถูกบันทึกเป็นข้อความ (กันการฉีดสูตรเข้าชีต)
- ทุกการแก้ไขบันทึกในชีต `Log` (เวลา อีเมล การกระทำ)
- ไฟล์หลักฐานจริงยังอยู่ใน Google Drive ตามลิงก์ที่ครูแนบ — ตั้งสิทธิ์แชร์ไฟล์ให้เฉพาะคนในโรงเรียน
- ข้อมูลผู้เรียนรายบุคคลไม่ควรใส่ในระบบนี้ (เก็บเฉพาะข้อมูลสรุประดับโรงเรียน) ตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล

## แก้ปัญหา

| อาการ | สาเหตุที่พบบ่อย |
|---|---|
| ปุ่ม Sign in ไม่ขึ้น / ขึ้น "origin_mismatch" | ยังไม่ได้เพิ่ม `https://chanok109.github.io` ใน Authorized JavaScript origins |
| "โทเคนไม่ได้ออกให้เว็บไซต์นี้" | `CLIENT_ID` ใน Script Properties ไม่ตรงกับ `googleClientId` ใน config.js |
| "เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง" | Web App ไม่ได้ตั้ง Who has access = Anyone หรือ URL ไม่ใช่ `/exec` |
| "ยังไม่ได้ตั้งค่า CLIENT_ID / ALLOWED_DOMAIN" | ยังไม่ได้ทำขั้นที่ 3 |
| แก้โค้ดแล้วไม่มีผล | ยังไม่ได้ deploy เป็น New version |
