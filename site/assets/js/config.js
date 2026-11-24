/*
 * การเชื่อมต่อ Google Sheets + ล็อกอินด้วยบัญชีโรงเรียน
 * ถ้า apiUrl หรือ googleClientId ว่าง เว็บไซต์จะทำงานใน "โหมดทดลอง" (เก็บข้อมูลในเบราว์เซอร์เท่านั้น)
 * วิธีตั้งค่า: ดู apps-script/README.md
 */
window.IQA_CONFIG = {
  apiUrl: "",            // URL ของ Apps Script Web App (ลงท้ายด้วย /exec)
  googleClientId: "",    // OAuth Client ID (ลงท้ายด้วย .apps.googleusercontent.com)
  allowedDomain: "pcccr.ac.th",
};
