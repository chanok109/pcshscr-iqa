/*
 * แบบจำลองข้อมูลรายปีการศึกษา
 * ค่าตั้งค่าของแต่ละปี = { academicYear, previousYear, goals, strategies, standards }
 * ค่าตั้งต้นมาจาก data.js และแก้ไขได้ที่หน้า "หลังบ้าน"
 *
 * ทุกตัวชี้วัดและรายการตรวจสอบมี id คงที่ ผลการประเมินผูกกับ id นี้
 * (ไม่ใช่ลำดับ) จึงจัดเรียงหรือลบรายการอื่นได้โดยผลไม่เลื่อนไปผิดตัว
 */
(function () {
  "use strict";
  const D = window.IQA_DATA;
  const uid = () => "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const clone = (x) => JSON.parse(JSON.stringify(x));

  function normalizeYear(input) {
    const cfg = clone(input || {});
    cfg.academicYear = String(cfg.academicYear || "");
    cfg.previousYear = String(cfg.previousYear || "");
    cfg.goals = Array.isArray(cfg.goals) ? cfg.goals : [];
    cfg.strategies = Array.isArray(cfg.strategies) ? cfg.strategies : [];
    cfg.standards = Array.isArray(cfg.standards) ? cfg.standards : [];
    cfg.goals.forEach((g, k) => { if (!g.id) g.id = "g" + (k + 1) + uid(); });
    cfg.strategies.forEach((s, k) => {
      if (!s.id) s.id = "s" + (k + 1) + uid();
      s.goals = Array.isArray(s.goals) ? s.goals : [];
      s.standards = Array.isArray(s.standards) ? s.standards : [];
    });
    cfg.standards.forEach((s) => {
      s.issues = Array.isArray(s.issues) ? s.issues : [];
      s.issues.forEach((i) => {
        if (i.indicators) i.indicators.forEach((ind, k) => { if (ind.id == null || ind.id === "") ind.id = String(k); });
        if (i.checklist) {
          i.checklist = i.checklist.map((t, k) => (typeof t === "string" ? { id: String(k), text: t } : { id: t.id != null && t.id !== "" ? String(t.id) : String(k), text: t.text || "" }));
        }
        if (i.rubric) i.rubric = [0, 1, 2, 3, 4].map((k) => String(i.rubric[k] || ""));
      });
    });
    return cfg;
  }

  function seedYear() {
    return normalizeYear({
      academicYear: D.school.academicYear,
      previousYear: D.school.previousYear,
      goals: D.goals,
      strategies: D.strategies,
      standards: D.standards,
    });
  }

  const DEFAULT_BANDS = [
    { level: 5, min: 90 }, { level: 4, min: 80 }, { level: 3, min: 70 }, { level: 2, min: 60 }, { level: 1, min: 0 },
  ];
  const DEFAULT_SCORE_BANDS = [
    { level: 5, min: 25 }, { level: 4, min: 20 }, { level: 3, min: 14 }, { level: 2, min: 8 }, { level: 1, min: 0 },
  ];

  window.IQAModel = { uid, clone, normalizeYear, seedYear, SEED_YEAR: D.school.academicYear, DEFAULT_BANDS, DEFAULT_SCORE_BANDS };
})();
