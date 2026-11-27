/*
 * ระบบหลังบ้าน: ปีการศึกษา · เป้าหมาย · กลยุทธ์ · มาตรฐาน ตัวชี้วัด ค่าเป้าหมาย
 * แก้ไขบน "ฉบับร่าง" ของปีการศึกษาที่เลือก แล้วกดบันทึกเพื่อเผยแพร่
 */
(function () {
  "use strict";

  const M = window.IQAModel;
  const app = () => window.IQAApp;
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const has = (v) => v !== "" && v != null && !isNaN(v);
  const LEVEL_NAMES = { 5: "ยอดเยี่ยม", 4: "ดีเลิศ", 3: "ดี", 2: "ปานกลาง", 1: "กำลังพัฒนา" };
  const METHODS = {
    percent: "ค่าร้อยละเฉลี่ยของตัวชี้วัด เทียบเกณฑ์",
    achievement: "ร้อยละความสำเร็จเทียบกับค่าเป้าหมาย",
    checklist: "นับข้อที่ปฏิบัติได้ / เลือกระดับตาม rubric แล้วรวมคะแนน",
  };
  const UNITS = ["%", "คน", "ผลงาน", "รางวัล", "ครั้ง/ปี", "ทุน", "เครือข่าย", "ชิ้น", "เรื่อง"];

  const st = { tab: "years", year: null, draft: null, saved: "", errors: [], std: 0, open: new Set(["iss-0-0"]), bound: false };

  // ---------------------------------------------------------------- helpers
  const isDirty = () => Boolean(st.draft) && JSON.stringify(st.draft) !== st.saved;
  const parts = (path) => path.split(".").map((k) => (/^\d+$/.test(k) ? Number(k) : k));
  function getPath(obj, path) { return parts(path).reduce((o, k) => (o == null ? o : o[k]), obj); }
  function setPath(obj, path, value) {
    const ks = parts(path);
    let o = obj;
    ks.slice(0, -1).forEach((k, i) => {
      if (o[k] == null || typeof o[k] !== "object") o[k] = typeof ks[i + 1] === "number" ? [] : {};
      o = o[k];
    });
    o[ks[ks.length - 1]] = value;
  }
  function nextCode(list, prefix = "") {
    const n = list.reduce((m, x) => Math.max(m, parseInt(String(x.code || "").split(".").pop(), 10) || 0), 0) + 1;
    return prefix ? `${prefix}.${n}` : String(n);
  }
  const levelOptions = (v, empty = "—") => `<option value="">${empty}</option>` +
    [5, 4, 3, 2, 1].map((l) => `<option value="${l}" ${Number(v) === l ? "selected" : ""}>${l} ${LEVEL_NAMES[l]}</option>`).join("");

  function markDirty() {
    const bar = $("#adm-dirty");
    if (bar) bar.hidden = !isDirty();
  }

  async function edit(year) {
    year = String(year);
    let cfg = null;
    try { cfg = await app().loadYearConfig(year); } catch (e) { app().toast(e.message, "error"); }
    if (!cfg) cfg = M.normalizeYear({ academicYear: year, previousYear: String(Number(year) - 1) });
    st.year = year;
    st.std = 0;
    st.open = new Set(["iss-0-0"]);
    st.draft = cfg;
    st.saved = JSON.stringify(cfg);
    st.errors = [];
  }

  function confirmDiscard() {
    return !isDirty() || confirm("มีการแก้ไขที่ยังไม่บันทึก ต้องการทิ้งการแก้ไขหรือไม่?");
  }

  // ---------------------------------------------------------------- validation
  function validate(cfg) {
    const errs = [];
    if (!/^\d{4}$/.test(cfg.academicYear)) errs.push("ปีการศึกษาต้องเป็นตัวเลข 4 หลัก");
    const seenStd = new Set();
    const seenIssue = new Set();
    cfg.goals.forEach((g, k) => { if (!String(g.text || "").trim()) errs.push(`เป้าหมายลำดับที่ ${k + 1}: ยังไม่ได้กรอกข้อความ`); });
    cfg.strategies.forEach((s, k) => { if (!String(s.name || "").trim()) errs.push(`กลยุทธ์ลำดับที่ ${k + 1}: ยังไม่ได้กรอกชื่อกลยุทธ์`); });
    cfg.standards.forEach((s, si) => {
      const where = `มาตรฐานลำดับที่ ${si + 1}${s.code ? ` (มาตรฐานที่ ${s.code})` : ""}`;
      if (!/^\d+$/.test(String(s.code || ""))) errs.push(`${where}: รหัสมาตรฐานต้องเป็นตัวเลข`);
      else if (seenStd.has(s.code)) errs.push(`${where}: รหัสมาตรฐานซ้ำ`);
      seenStd.add(s.code);
      if (!String(s.name || "").trim()) errs.push(`${where}: ยังไม่ได้กรอกชื่อมาตรฐาน`);
      const bands = (s.method === "checklist" ? s.scoreBands : s.bands) || [];
      const mins = bands.filter((b) => b.level > 1).map((b) => Number(b.min));
      if (mins.some((m) => !isFinite(m)) || mins.some((m, i) => i > 0 && m >= mins[i - 1])) errs.push(`${where}: เกณฑ์ระดับคุณภาพต้องเป็นตัวเลขและลดหลั่นจากยอดเยี่ยมลงไป`);
      s.issues.forEach((i, ii) => {
        const iw = `${where} ประเด็นลำดับที่ ${ii + 1}${i.code ? ` (${i.code})` : ""}`;
        if (!/^\d+(\.\d+){1,2}$/.test(String(i.code || ""))) errs.push(`${iw}: รหัสประเด็นต้องอยู่ในรูป 1.1 หรือ 1.1.1`);
        else if (seenIssue.has(i.code)) errs.push(`${iw}: รหัสประเด็นซ้ำ`);
        seenIssue.add(i.code);
        if (!String(i.name || "").trim()) errs.push(`${iw}: ยังไม่ได้กรอกชื่อประเด็น`);
        if (i.indicators) {
          if (!i.indicators.length) errs.push(`${iw}: ยังไม่มีตัวชี้วัด`);
          i.indicators.forEach((ind, k) => {
            if (!String(ind.name || "").trim()) errs.push(`${iw} ตัวชี้วัดที่ ${k + 1}: ยังไม่ได้กรอกชื่อ`);
            if (!has(ind.target) || Number(ind.target) <= 0) errs.push(`${iw} ตัวชี้วัดที่ ${k + 1}: ค่าเป้าหมายต้องเป็นตัวเลขมากกว่า 0`);
          });
        } else if (i.checklist) {
          if (!i.checklist.length) errs.push(`${iw}: ยังไม่มีรายการประเมิน`);
          i.checklist.forEach((c, k) => { if (!String(c.text || "").trim()) errs.push(`${iw} รายการที่ ${k + 1}: ยังไม่ได้กรอกข้อความ`); });
        } else if (i.rubric) {
          i.rubric.forEach((t, k) => { if (!String(t || "").trim()) errs.push(`${iw}: ยังไม่ได้กรอกคำอธิบายระดับ ${k + 1}`); });
        } else {
          errs.push(`${iw}: ยังไม่ได้กำหนดตัวชี้วัด`);
        }
      });
    });
    return errs;
  }

  // ---------------------------------------------------------------- templates
  function newIssue(std) {
    const code = nextCode(std.issues, std.code);
    if (std.method === "checklist") return { code, name: "", prevLevel: null, checklist: [] };
    return { code, name: "", prevLevel: null, indicators: [] };
  }
  const TEMPLATES = {
    goal: (list) => ({ id: "g" + M.uid(), code: nextCode(list), text: "" }),
    strategy: (list) => ({ id: "s" + M.uid(), code: nextCode(list), name: "", goals: [], standards: [] }),
    standard: (list) => ({
      code: nextCode(list), name: "", method: "percent", bands: M.clone(M.DEFAULT_BANDS),
      targetText: "ยอดเยี่ยม", model: "", focus: "", criteria: "", prev: null, review: null, issues: [],
    }),
    indicator: () => ({ id: M.uid(), name: "", target: null, prev: null, unit: "%", dir: "max" }),
    check: () => ({ id: M.uid(), text: "" }),
  };

  // ---------------------------------------------------------------- render
  const SECTIONS = {
    years: ["ปีการศึกษา", "เพิ่มปีการศึกษา กำหนดปีปัจจุบันของเว็บไซต์ และจัดการข้อมูลสำรอง"],
    goals: ["เป้าหมาย", "อุดมการณ์และเป้าหมายการพัฒนาของโรงเรียน ใช้เชื่อมโยงกับกลยุทธ์"],
    strategies: ["กลยุทธ์", "กลยุทธ์ของโรงเรียน และมาตรฐาน/เป้าหมายที่แต่ละกลยุทธ์ขับเคลื่อน"],
    standards: ["มาตรฐาน ตัวชี้วัด ค่าเป้าหมาย", "ประเด็นพิจารณา ตัวชี้วัด ค่าเป้าหมาย และเกณฑ์ตัดสินระดับคุณภาพของแต่ละมาตรฐาน"],
  };
  const itemCount = (i) => (i.indicators ? i.indicators.length : i.checklist ? i.checklist.length : i.rubric ? 1 : 0);
  const itemWord = (s) => (s.method === "checklist" ? "รายการ" : "ตัวชี้วัด");
  const fmtN = (v) => Number(v).toLocaleString("th-TH", { maximumFractionDigits: 2 });

  function render() {
    const root = $("#admin-app");
    if (!root) return;
    bind(root);
    if (!st.draft || st.year == null) {
      root.innerHTML = `<p class="hint">กำลังโหลด…</p>`;
      edit(app().year).then(render);
      return;
    }
    const Y = app().years;
    const d = st.draft;
    const nIssues = d.standards.reduce((a, s) => a + s.issues.length, 0);
    const nav = [
      ["years", `${Y.years.length} ปี`],
      ["goals", `${d.goals.length} ข้อ`],
      ["strategies", `${d.strategies.length} กลยุทธ์`],
      ["standards", `${d.standards.length} มาตรฐาน · ${nIssues} ประเด็น`],
    ];
    const editing = st.tab !== "years";
    const [title, desc] = SECTIONS[st.tab];
    root.innerHTML = `
      <div class="adm">
        <aside class="adm-side">
          <label class="adm-side-year">
            <span>ปีการศึกษาที่แก้ไข</span>
            <select data-act="edit-year">${Y.years.map((y) => `<option value="${esc(y.year)}" ${y.year === st.year ? "selected" : ""}>${esc(y.year)}</option>`).join("")}</select>
            <small>${st.year === Y.active ? "เป็นปีปัจจุบันของเว็บไซต์" : "ไม่ใช่ปีปัจจุบันของเว็บไซต์"}</small>
          </label>
          <nav class="adm-nav" role="tablist" aria-label="ส่วนของหลังบ้าน">${nav.map(([k, meta]) =>
            `<button type="button" role="tab" class="adm-nav-item ${st.tab === k ? "on" : ""}" aria-selected="${st.tab === k}" data-act="tab" data-tab="${k}">
              <span>${SECTIONS[k][0]}</span><small>${meta}</small></button>`).join("")}</nav>
        </aside>

        <section class="adm-main">
          <header class="adm-head">
            <div class="adm-head-text"><h2>${title}</h2><p>${desc}</p></div>
            ${editing ? `<div class="adm-head-actions">
              <span class="adm-dirty" id="adm-dirty" ${isDirty() ? "" : "hidden"}>ยังไม่บันทึก</span>
              <button type="button" class="btn" data-act="discard">ยกเลิกการแก้ไข</button>
              <button type="button" class="btn primary" data-act="save">บันทึกปี ${esc(st.year)}</button>
            </div>` : ""}
          </header>
          ${st.errors.length ? `<div class="adm-errors" role="alert"><strong>ยังบันทึกไม่ได้ ต้องแก้ ${st.errors.length} รายการ</strong><ul>${st.errors.slice(0, 10).map((e) => `<li>${esc(e)}</li>`).join("")}${st.errors.length > 10 ? `<li>และอีก ${st.errors.length - 10} รายการ</li>` : ""}</ul></div>` : ""}
          <div class="adm-body">${({ years: renderYears, goals: renderGoals, strategies: renderStrategies, standards: renderStandards })[st.tab]()}</div>
        </section>
      </div>
      <datalist id="adm-units">${UNITS.map((u) => `<option value="${esc(u)}">`).join("")}</datalist>`;
    root.querySelectorAll("textarea").forEach(autosize);
  }

  // ให้ช่องข้อความสูงพอดีกับเนื้อหา อ่านได้ครบโดยไม่ต้องเลื่อนในช่อง
  function autosize(t) {
    if (!t.offsetParent) return;
    t.rows = 1;
    t.style.height = "auto";
    t.style.height = t.scrollHeight + 2 + "px";
  }

  const card = (title, body, { meta = "", tools = "", cls = "" } = {}) => `
    <section class="adm-card ${cls}">
      <header class="adm-card-h"><h3>${title}${meta ? ` <small>${meta}</small>` : ""}</h3>${tools ? `<div class="adm-card-tools">${tools}</div>` : ""}</header>
      ${body}
    </section>`;

  // ไอคอนปุ่มเลื่อน/ลบ — มีข้อความกำกับสำหรับโปรแกรมอ่านหน้าจอ
  const rowTools = (list, k, n, what = "") => `<span class="adm-tools">
      <button type="button" class="icon-btn" data-act="up" data-list="${list}" data-index="${k}" ${k === 0 ? "disabled" : ""} aria-label="เลื่อน${what}ขึ้น" title="เลื่อนขึ้น">↑</button>
      <button type="button" class="icon-btn" data-act="down" data-list="${list}" data-index="${k}" ${k === n - 1 ? "disabled" : ""} aria-label="เลื่อน${what}ลง" title="เลื่อนลง">↓</button>
      <button type="button" class="icon-btn danger" data-act="remove" data-list="${list}" data-index="${k}" aria-label="ลบ${what}" title="ลบ">✕</button></span>`;

  // ---------- ปีการศึกษา
  function renderYears() {
    const Y = app().years;
    const last = Y.years[Y.years.length - 1].year;
    const list = Y.years.slice().reverse().map((y) => {
      const active = y.year === Y.active;
      const saved = Boolean(y.updatedAt);
      return `<li class="year-item ${active ? "is-active" : ""} ${y.year === st.year ? "is-editing" : ""}">
        <span class="year-num">${esc(y.year)}</span>
        <div class="year-meta">
          <div class="year-tags">${active ? `<span class="tag tag-active">ปีปัจจุบัน</span>` : ""}${y.year === st.year ? `<span class="tag">กำลังแก้ไข</span>` : ""}${saved ? "" : `<span class="tag tag-muted">ค่าตั้งต้น ยังไม่บันทึก</span>`}</div>
          <small>${saved ? `แก้ไขล่าสุด ${esc(new Date(y.updatedAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }))}${y.updatedBy ? ` โดย ${esc(y.updatedBy)}` : ""}` : "ใช้ค่าตามประกาศของโรงเรียน กดบันทึกเพื่อเก็บลงระบบ"}</small>
        </div>
        <div class="year-acts">
          <button type="button" class="btn small" data-act="goto-edit" data-year="${esc(y.year)}">แก้ไข</button>
          ${active ? "" : `<button type="button" class="btn small" data-act="activate" data-year="${esc(y.year)}" ${saved ? "" : "disabled title=\"บันทึกปีนี้ก่อน\""}>ตั้งเป็นปีปัจจุบัน</button>
          <button type="button" class="icon-btn danger" data-act="delete-year" data-year="${esc(y.year)}" aria-label="ลบปีการศึกษา ${esc(y.year)}" title="ลบ">✕</button>`}
        </div>
      </li>`;
    }).join("");

    return `<div class="adm-cols">
      <div class="adm-stack">
        ${card("ปีการศึกษาในระบบ", `<ul class="year-list">${list}</ul>
          <p class="hint">ปีปัจจุบันคือปีที่เว็บไซต์แสดงเป็นค่าเริ่มต้น ผู้ใช้เลือกดูปีอื่นได้จากแถบด้านบน</p>`)}
      </div>
      <div class="adm-stack">
        <form class="adm-card" data-form="newyear">
          <header class="adm-card-h"><h3>เพิ่มปีการศึกษา</h3></header>
          <div class="field-grid two">
            <label class="field">ปีการศึกษา (พ.ศ.)<input name="year" inputmode="numeric" pattern="\\d{4}" maxlength="4" required placeholder="${esc(String(Number(last) + 1))}"></label>
            <label class="field">คัดลอกค่าตั้งค่าจาก
              <select name="from"><option value="">เริ่มต้นจากว่าง</option>${Y.years.map((y) => `<option value="${esc(y.year)}" ${y.year === last ? "selected" : ""}>ปีการศึกษา ${esc(y.year)}</option>`).join("")}</select></label>
          </div>
          <label class="check"><input type="checkbox" name="useResults" checked>
            <span>ใช้ผลการประเมินของปีต้นทางเป็น "ผลปีก่อน" ของปีใหม่</span></label>
          <div class="adm-card-foot"><button class="btn primary" type="submit">สร้างปีการศึกษา</button></div>
        </form>

        ${card("เครื่องมือข้อมูล", `
          <div class="tool-row">
            <div><strong>ค่าตั้งค่าปี ${esc(st.year)}</strong><small>ส่งออกเป็นไฟล์ หรือนำเข้าแทนฉบับร่าง (ต้องกดบันทึกหลังนำเข้า)</small></div>
            <div class="tool-btns">
              <button type="button" class="btn small" data-act="export">ส่งออก JSON</button>
              <label class="btn small file-btn">นำเข้า JSON<input type="file" accept="application/json" data-act="import" hidden></label>
            </div>
          </div>
          <div class="tool-row">
            <div><strong>สำรองข้อมูลทั้งหมด</strong><small>ค่าตั้งค่า ผลการประเมิน ระดับที่ตัดสิน บันทึก และรายการหลักฐาน ในไฟล์เดียว</small></div>
            <div class="tool-btns">
              <select id="backup-year" aria-label="ปีการศึกษาที่จะสำรอง"><option value="">ทุกปีการศึกษา</option>${Y.years.map((y) => `<option value="${esc(y.year)}">ปี ${esc(y.year)}</option>`).join("")}</select>
              <button type="button" class="btn small primary" data-act="backup">ดาวน์โหลด</button>
            </div>
          </div>`)}
      </div>
    </div>`;
  }

  // ---------- เป้าหมาย
  function renderGoals() {
    const g = st.draft.goals;
    return card(`เป้าหมาย ปีการศึกษา ${esc(st.year)}`, `
      <ol class="num-list">${g.map((x, k) => `<li class="num-item">
        <input class="num-badge" data-bind="goals.${k}.code" value="${esc(x.code)}" aria-label="ข้อที่">
        <textarea rows="2" data-bind="goals.${k}.text" aria-label="ข้อความเป้าหมาย" placeholder="ข้อความเป้าหมาย">${esc(x.text)}</textarea>
        ${rowTools("goals", k, g.length, "เป้าหมาย")}</li>`).join("") || `<li class="empty">ยังไม่มีเป้าหมาย</li>`}</ol>
      <button type="button" class="btn add-btn" data-act="add" data-list="goals" data-kind="goal">+ เพิ่มเป้าหมาย</button>`,
    { meta: `${g.length} ข้อ` });
  }

  // ---------- กลยุทธ์
  function renderStrategies() {
    const ss = st.draft.strategies;
    const goals = st.draft.goals;
    const stds = st.draft.standards;
    return `<div class="adm-stack">${ss.map((x, k) => `
      <article class="adm-card strat">
        <div class="num-item">
          <input class="num-badge" data-bind="strategies.${k}.code" value="${esc(x.code)}" aria-label="กลยุทธ์ที่">
          <textarea rows="2" data-bind="strategies.${k}.name" aria-label="ชื่อกลยุทธ์" placeholder="ชื่อกลยุทธ์">${esc(x.name)}</textarea>
          ${rowTools("strategies", k, ss.length, "กลยุทธ์")}
        </div>
        <div class="strat-links">
          <div><h4>มาตรฐานที่ขับเคลื่อน</h4><div class="pills">${stds.map((s) => `<label class="pill"><input type="checkbox" data-toggle="strategies.${k}.standards" value="${esc(s.code)}" ${x.standards.includes(s.code) ? "checked" : ""}> มาตรฐานที่ ${esc(s.code)}</label>`).join("") || `<span class="hint">ยังไม่มีมาตรฐาน</span>`}</div></div>
          <div><h4>เป้าหมายที่เกี่ยวข้อง</h4><div class="pills">${goals.map((g) => `<label class="pill" title="${esc(g.text)}"><input type="checkbox" data-toggle="strategies.${k}.goals" value="${esc(g.id)}" ${x.goals.includes(g.id) ? "checked" : ""}> ${esc(g.code)}</label>`).join("") || `<span class="hint">ยังไม่มีเป้าหมาย</span>`}</div></div>
        </div>
      </article>`).join("") || `<div class="adm-card"><p class="empty">ยังไม่มีกลยุทธ์</p></div>`}
      <button type="button" class="btn add-btn" data-act="add" data-list="strategies" data-kind="strategy">+ เพิ่มกลยุทธ์</button>
    </div>`;
  }

  // ---------- มาตรฐาน ตัวชี้วัด ค่าเป้าหมาย (เลือกทีละมาตรฐาน)
  function renderStandards() {
    const stds = st.draft.standards;
    if (st.std >= stds.length) st.std = Math.max(0, stds.length - 1);
    const picker = stds.map((s, si) => {
      const n = s.issues.reduce((a, i) => a + itemCount(i), 0);
      return `<li><button type="button" class="std-pick ${si === st.std ? "on" : ""}" data-act="pick-std" data-index="${si}" aria-current="${si === st.std}">
        <span class="std-no">มาตรฐานที่ ${esc(s.code)}</span>
        <strong>${esc(s.name) || "ยังไม่มีชื่อ"}</strong>
        <small>${s.issues.length} ประเด็น · ${n} ${itemWord(s)}</small></button></li>`;
    }).join("");
    return `<div class="std-layout">
      <nav class="std-picker" aria-label="เลือกมาตรฐาน">
        <select class="std-picker-select" data-act="pick-std-select" aria-label="เลือกมาตรฐาน">${stds.map((s, si) => `<option value="${si}" ${si === st.std ? "selected" : ""}>มาตรฐานที่ ${esc(s.code)} ${esc(s.name)}</option>`).join("")}</select>
        <ol>${picker}</ol>
        <button type="button" class="btn add-btn" data-act="add" data-list="standards" data-kind="standard">+ เพิ่มมาตรฐาน</button>
      </nav>
      <div class="std-detail">${stds.length ? renderStandard(stds[st.std], st.std, stds.length) : `<div class="adm-card"><p class="empty">ยังไม่มีมาตรฐาน เริ่มจากปุ่ม "เพิ่มมาตรฐาน"</p></div>`}</div>
    </div>`;
  }

  function renderStandard(s, si, n) {
    const P = `standards.${si}`;
    const bandsKey = s.method === "checklist" ? "scoreBands" : "bands";
    const bands = s[bandsKey] || [];
    const rv = s.review || {};
    const rvCount = ["strengths", "improve", "suggest"].map((k) => (rv[k] || []).length);
    const unit = s.method === "checklist" ? "คะแนนรวม" : s.method === "achievement" ? "ร้อยละความสำเร็จ" : "ร้อยละ";

    const info = card(`มาตรฐานที่ ${esc(s.code)}`, `
      <div class="field-grid">
        <label class="field narrow">รหัส<input data-bind="${P}.code" value="${esc(s.code)}"></label>
        <label class="field wide">ชื่อมาตรฐาน<input data-bind="${P}.name" value="${esc(s.name)}"></label>
        <label class="field">ค่าเป้าหมายระดับมาตรฐาน<input data-bind="${P}.targetText" value="${esc(s.targetText)}" placeholder="เช่น ยอดเยี่ยม (ร้อยละ 90.81)"></label>
        <label class="field">ผลปี ${esc(st.draft.previousYear)}<select data-bind="${P}.prev.level" data-type="level">${levelOptions(s.prev && s.prev.level)}</select></label>
        <label class="field wide">นวัตกรรม/วิธีปฏิบัติที่เป็นเลิศ<input data-bind="${P}.model" value="${esc(s.model)}"></label>
        <label class="field full">จุดเน้น<textarea rows="2" data-bind="${P}.focus">${esc(s.focus)}</textarea></label>
      </div>`, { tools: rowTools("standards", si, n, "มาตรฐาน") });

    const method = card("วิธีตัดสินระดับคุณภาพ", `
      <div class="method-grid" role="radiogroup" aria-label="วิธีตัดสินระดับคุณภาพ">${Object.entries(METHODS).map(([k, v]) => `
        <label class="method-opt ${s.method === k ? "on" : ""}">
          <input type="radio" name="method-${si}" value="${k}" data-act="method" data-std="${si}" ${s.method === k ? "checked" : ""}>
          <strong>${({ percent: "ค่าร้อยละ", achievement: "ความสำเร็จเทียบเป้าหมาย", checklist: "รายการตรวจสอบ / rubric" })[k]}</strong>
          <small>${v}</small></label>`).join("")}</div>
      <div class="bands">
        <span class="bands-label">เกณฑ์ขั้นต่ำ (${unit})</span>
        ${bands.filter((b) => b.level > 1).map((b) => `<label class="band"><span class="badge lv${b.level}"><b>${b.level}</b>${LEVEL_NAMES[b.level]}</span>
          <input type="number" step="any" data-type="num" data-bind="${P}.${bandsKey}.${bands.indexOf(b)}.min" value="${esc(b.min)}" aria-label="เกณฑ์ขั้นต่ำระดับ ${LEVEL_NAMES[b.level]}"></label>`).join("")}
        <span class="hint">ต่ำกว่าระดับปานกลาง = กำลังพัฒนา</span>
      </div>
      <label class="field full">คำอธิบายเกณฑ์ (แสดงในหน้ามาตรฐาน)<textarea rows="2" data-bind="${P}.criteria">${esc(s.criteria)}</textarea></label>`);

    const review = `<details class="adm-card adm-collapse" data-key="rv-${si}" ${st.open.has(`rv-${si}`) ? "open" : ""}>
      <summary class="adm-card-h"><h3>สรุปจาก SAR ปีก่อน <small>${rvCount[0]} จุดเด่น · ${rvCount[1]} จุดที่ควรพัฒนา · ${rvCount[2]} ข้อเสนอแนะ</small></h3><span class="chev" aria-hidden="true"></span></summary>
      <div class="field-grid three">
        <label class="field">จุดเด่น <small>บรรทัดละข้อ</small><textarea rows="5" data-type="lines" data-bind="${P}.review.strengths">${esc((rv.strengths || []).join("\n"))}</textarea></label>
        <label class="field">จุดที่ควรพัฒนา <small>บรรทัดละข้อ</small><textarea rows="5" data-type="lines" data-bind="${P}.review.improve">${esc((rv.improve || []).join("\n"))}</textarea></label>
        <label class="field">ข้อเสนอแนะ <small>บรรทัดละข้อ</small><textarea rows="5" data-type="lines" data-bind="${P}.review.suggest">${esc((rv.suggest || []).join("\n"))}</textarea></label>
      </div>
    </details>`;

    const issues = card("ประเด็นพิจารณา", `
      <div class="issue-list">${s.issues.map((i, ii) => renderIssue(s, si, i, ii)).join("") || `<p class="empty">ยังไม่มีประเด็นพิจารณา</p>`}</div>
      <button type="button" class="btn add-btn" data-act="add" data-list="${P}.issues" data-kind="issue" data-std="${si}">+ เพิ่มประเด็นพิจารณา</button>`,
    { meta: `${s.issues.length} ประเด็น`, cls: "issues-card" });

    return `<div class="adm-stack">${info}${method}${issues}${review}</div>`;
  }

  function renderIssue(s, si, i, ii) {
    const P = `standards.${si}.issues.${ii}`;
    const kind = i.rubric ? "rubric" : i.checklist ? "checklist" : "indicators";
    const key = `iss-${si}-${ii}`;
    const n = itemCount(i);
    let summary = kind === "rubric" ? "เลือกระดับตาม rubric" : `${n} ${kind === "checklist" ? "รายการ" : "ตัวชี้วัด"}`;
    if (kind === "indicators" && s.method === "percent" && n) {
      const t = i.indicators.map((x) => Number(x.target)).filter((x) => isFinite(x) && x > 0);
      if (t.length) summary += ` · เป้าหมายเฉลี่ย ${fmtN(t.reduce((a, b) => a + b, 0) / t.length)}`;
    }
    let body = "";
    if (kind === "indicators") {
      body = `<div class="ind-table" role="table" aria-label="ตัวชี้วัดของประเด็น ${esc(i.code)}">
        <div class="ind-row ind-head" role="row"><span role="columnheader">#</span><span role="columnheader">ตัวชี้วัด</span><span role="columnheader">ค่าเป้าหมาย</span><span role="columnheader">หน่วย</span><span role="columnheader">ทิศทาง</span><span role="columnheader">ผลปี ${esc(st.draft.previousYear)}</span><span role="columnheader"><span class="sr-only">จัดการ</span></span></div>
        ${i.indicators.map((ind, k) => `<div class="ind-row" role="row">
          <span class="ind-no" role="cell">${k + 1}</span>
          <label role="cell" class="ind-name"><span class="sr-only">ชื่อตัวชี้วัด</span><textarea rows="2" data-bind="${P}.indicators.${k}.name" placeholder="ชื่อตัวชี้วัด">${esc(ind.name)}</textarea></label>
          <label role="cell"><span class="ind-lbl">ค่าเป้าหมาย</span><input type="number" step="any" min="0" class="num-in" data-type="num" data-bind="${P}.indicators.${k}.target" value="${esc(ind.target ?? "")}"></label>
          <label role="cell"><span class="ind-lbl">หน่วย</span><input list="adm-units" class="unit-in" data-bind="${P}.indicators.${k}.unit" value="${esc(ind.unit || "%")}"></label>
          <label role="cell"><span class="ind-lbl">ทิศทาง</span><select data-bind="${P}.indicators.${k}.dir"><option value="max" ${ind.dir !== "min" ? "selected" : ""}>ไม่น้อยกว่า</option><option value="min" ${ind.dir === "min" ? "selected" : ""}>ไม่เกิน</option></select></label>
          <label role="cell"><span class="ind-lbl">ผลปีก่อน</span><input type="number" step="any" min="0" class="num-in" data-type="num" data-bind="${P}.indicators.${k}.prev" value="${esc(ind.prev ?? "")}" placeholder="ใหม่"></label>
          <span role="cell">${rowTools(`${P}.indicators`, k, i.indicators.length, "ตัวชี้วัด")}</span>
        </div>`).join("") || `<p class="empty">ยังไม่มีตัวชี้วัด</p>`}
      </div>
      <button type="button" class="btn small add-btn" data-act="add" data-list="${P}.indicators" data-kind="indicator">+ เพิ่มตัวชี้วัด</button>`;
    } else if (kind === "checklist") {
      body = `<ol class="num-list compact">${i.checklist.map((c, k) => `<li class="num-item">
          <span class="num-badge static">${esc(i.code)}.${k + 1}</span>
          <textarea rows="2" data-bind="${P}.checklist.${k}.text" aria-label="รายการที่ ${k + 1}">${esc(c.text)}</textarea>
          ${rowTools(`${P}.checklist`, k, i.checklist.length, "รายการ")}</li>`).join("") || `<li class="empty">ยังไม่มีรายการ</li>`}</ol>
        <button type="button" class="btn small add-btn" data-act="add" data-list="${P}.checklist" data-kind="check">+ เพิ่มรายการประเมิน</button>`;
    } else {
      body = `<div class="rubric-edit">${[4, 3, 2, 1, 0].map((k) => `<label><span class="badge lv${k + 1}"><b>${k + 1}</b>${LEVEL_NAMES[k + 1]}</span>
          <textarea rows="2" data-bind="${P}.rubric.${k}" aria-label="คำอธิบายระดับ ${LEVEL_NAMES[k + 1]}">${esc(i.rubric[k])}</textarea></label>`).join("")}</div>`;
    }
    return `<details class="issue" data-key="${key}" ${st.open.has(key) ? "open" : ""}>
      <summary class="issue-sum">
        <span class="issue-code">${esc(i.code) || "—"}</span>
        <span class="issue-name">${esc(i.name) || `<span class="hint">ยังไม่มีชื่อ</span>`}</span>
        <span class="issue-meta">${summary}</span>
        <span class="chev" aria-hidden="true"></span>
      </summary>
      <div class="issue-body">
        <div class="field-grid issue-grid ${s.method === "checklist" ? "with-kind" : ""}">
          <label class="field">รหัส<input data-bind="${P}.code" value="${esc(i.code)}"></label>
          <label class="field">ประเด็นพิจารณา<textarea rows="2" data-bind="${P}.name">${esc(i.name)}</textarea></label>
          <label class="field">ผลปี ${esc(st.draft.previousYear)}<select data-bind="${P}.prevLevel" data-type="level">${levelOptions(i.prevLevel)}</select></label>
          ${s.method === "checklist" ? `<label class="field">รูปแบบการประเมิน<select data-act="issue-kind" data-path="${P}">
            <option value="checklist" ${kind === "checklist" ? "selected" : ""}>รายการตรวจสอบ</option>
            <option value="rubric" ${kind === "rubric" ? "selected" : ""}>เลือกระดับ (rubric)</option></select></label>` : ""}
        </div>
        ${body}
        <div class="issue-foot"><span class="hint">จัดการประเด็นนี้</span>${rowTools(`standards.${si}.issues`, ii, s.issues.length, "ประเด็น")}</div>
      </div>
    </details>`;
  }

  // ---------------------------------------------------------------- actions
  async function save() {
    const cfg = M.normalizeYear(st.draft);
    st.errors = validate(cfg);
    if (st.errors.length) { render(); window.scrollTo(0, 0); return; }
    try {
      await app().run(() => app().store.saveYearConfig(st.year, cfg), `บันทึกปีการศึกษา ${st.year} แล้ว`);
      st.draft = cfg;
      st.saved = JSON.stringify(cfg);
      await app().refreshYears();
      if (st.year === app().year) await app().showYear(st.year);
      render();
    } catch (e) { /* toast แล้ว */ }
  }

  async function createYear(form) {
    const f = new FormData(form);
    const year = String(f.get("year") || "").trim();
    const from = String(f.get("from") || "");
    const useResults = f.get("useResults") === "on";
    if (!/^\d{4}$/.test(year)) { app().toast("ปีการศึกษาต้องเป็นตัวเลข 4 หลัก", "error"); return; }
    if (app().years.years.some((y) => y.year === year)) { app().toast(`มีปีการศึกษา ${year} อยู่แล้ว`, "error"); return; }
    let cfg;
    if (from) {
      const src = await app().loadYearConfig(from);
      cfg = M.clone(src);
      cfg.academicYear = year;
      cfg.previousYear = from;
      let data = null;
      if (useResults) {
        try { data = await app().store.load(from); } catch (e) { app().toast("โหลดผลการประเมินปี " + from + " ไม่สำเร็จ: " + e.message, "error"); return; }
      }
      const lv = data ? app().scoreWith(src, data) : null;
      cfg.standards.forEach((s) => {
        s.review = null;
        s.prev = lv && lv.standards[s.code] ? { level: lv.standards[s.code] } : null;
        s.issues.forEach((i) => {
          i.prevLevel = lv ? lv.issues[i.code] || null : null;
          delete i.prevValue;
          (i.indicators || []).forEach((ind) => {
            const v = data ? data.results[`${i.code}#${ind.id}`] : null;
            ind.prev = has(v) ? Number(v) : null;
          });
        });
      });
    } else {
      cfg = { academicYear: year, previousYear: String(Number(year) - 1), goals: [], strategies: [], standards: [] };
    }
    cfg = M.normalizeYear(cfg);
    try {
      await app().run(() => app().store.saveYearConfig(year, cfg), `สร้างปีการศึกษา ${year} แล้ว`);
      await app().refreshYears();
      await edit(year);
      st.tab = "standards";
      render();
    } catch (e) { /* toast แล้ว */ }
  }

  function downloadJson(name, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  // ไฟล์สำรอง: ค่าตั้งค่า + ข้อมูลผลการประเมินและหลักฐานของแต่ละปี
  async function backup(only) {
    const years = only ? [only] : app().years.years.map((y) => y.year);
    const out = {
      format: "pcshscr-iqa-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      exportedBy: (app().store.user && app().store.user.email) || "",
      source: app().store.mode === "remote" ? "google-sheets" : "browser",
      activeYear: app().years.active,
      years: [],
    };
    for (const year of years) {
      const config = await app().loadYearConfig(year);
      const data = await app().store.load(year);
      out.years.push({
        year,
        config,
        evidence: data.evidence || [],
        results: data.results || {},
        verdicts: data.verdicts || {},
        notes: data.notes || {},
      });
    }
    const stamp = new Date().toISOString().slice(0, 10);
    downloadJson(`iqa-backup-${only || "all"}-${stamp}.json`, out);
    const n = out.years.reduce((a, y) => a + Object.keys(y.results).length + y.evidence.length, 0);
    return { years: out.years.length, records: n };
  }

  function moveItem(list, k, d) {
    const j = k + d;
    if (j < 0 || j >= list.length) return;
    [list[k], list[j]] = [list[j], list[k]];
  }

  function changeMethod(si, method) {
    const s = st.draft.standards[si];
    if (s.method === method) return;
    const lose = s.issues.some((i) => (method === "checklist" ? i.indicators && i.indicators.length : (i.checklist && i.checklist.length) || i.rubric));
    if (lose && !confirm("การเปลี่ยนวิธีตัดสินจะล้างตัวชี้วัด/รายการประเมินเดิมของทุกประเด็นในมาตรฐานนี้ ต้องการเปลี่ยนหรือไม่?")) { render(); return; }
    s.method = method;
    s.issues.forEach((i) => {
      if (method === "checklist") { delete i.indicators; if (!i.rubric) i.checklist = i.checklist || []; }
      else { delete i.checklist; delete i.rubric; i.indicators = i.indicators || []; }
    });
    if (method === "checklist" && !s.scoreBands) s.scoreBands = M.clone(M.DEFAULT_SCORE_BANDS);
    if (method !== "checklist" && !s.bands) s.bands = M.clone(M.DEFAULT_BANDS);
    render();
  }

  function readValue(el) {
    const t = el.dataset.type;
    const v = el.value;
    if (t === "num") return v === "" ? null : Number(v);
    if (t === "level") return v === "" ? null : Number(v);
    if (t === "lines") return v.split("\n").map((x) => x.trim()).filter(Boolean);
    return v;
  }

  function onBind(el) {
    const path = el.dataset.bind;
    const value = readValue(el);
    // ผลปีก่อนระดับมาตรฐาน: เลือก "—" ให้ล้างทั้งออบเจ็กต์
    if (/\.prev\.level$/.test(path) && value == null) setPath(st.draft, path.replace(/\.level$/, ""), null);
    else setPath(st.draft, path, value);
    markDirty();
  }

  function bind(root) {
    if (st.bound) return;
    st.bound = true;

    root.addEventListener("input", (e) => {
      const el = e.target;
      if (el.tagName === "TEXTAREA") autosize(el);
      if (el.dataset.bind && el.tagName !== "SELECT") onBind(el);
    });

    root.addEventListener("change", async (e) => {
      const el = e.target;
      if (el.dataset.bind && el.tagName === "SELECT") { onBind(el); return; }
      if (el.dataset.toggle) {
        const list = getPath(st.draft, el.dataset.toggle);
        const i = list.indexOf(el.value);
        if (el.checked && i < 0) list.push(el.value);
        if (!el.checked && i >= 0) list.splice(i, 1);
        markDirty();
        return;
      }
      const act = el.dataset.act;
      if (act === "method") changeMethod(Number(el.dataset.std), el.value);
      else if (act === "issue-kind") {
        const issue = getPath(st.draft, el.dataset.path);
        if ((issue.checklist && issue.checklist.length) || (issue.rubric && issue.rubric.some(Boolean))) {
          if (!confirm("การเปลี่ยนรูปแบบจะล้างรายการเดิมของประเด็นนี้ ต้องการเปลี่ยนหรือไม่?")) { render(); return; }
        }
        delete issue.checklist; delete issue.rubric;
        if (el.value === "rubric") issue.rubric = ["", "", "", "", ""]; else issue.checklist = [];
        render();
      } else if (act === "edit-year") {
        if (!confirmDiscard()) { el.value = st.year; return; }
        await edit(el.value);
        render();
      } else if (act === "pick-std-select") {
        st.std = Number(el.value);
        st.open.add(`iss-${st.std}-0`);
        render();
      } else if (act === "io-year") {
        if (!confirmDiscard()) { el.value = st.year; return; }
        await edit(el.value);
      } else if (act === "import") {
        const file = el.files[0];
        el.value = "";
        if (!file) return;
        try {
          const obj = JSON.parse(await file.text());
          if (!obj || !Array.isArray(obj.standards)) throw new Error("ไฟล์ไม่ใช่ค่าตั้งค่าปีการศึกษา");
          if (!confirm(`แทนที่ฉบับร่างของปีการศึกษา ${st.year} ด้วยข้อมูลจากไฟล์?`)) return;
          st.draft = M.normalizeYear({ ...obj, academicYear: st.year });
          st.tab = "standards";
          render();
          app().toast("นำเข้าแล้ว ตรวจสอบแล้วกดบันทึก", "ok");
        } catch (err) { app().toast("นำเข้าไม่สำเร็จ: " + err.message, "error"); }
      }
    });

    root.addEventListener("click", async (e) => {
      const el = e.target.closest("[data-act]");
      if (!el || el.tagName === "SELECT" || el.type === "file") return;
      const act = el.dataset.act;
      if (act === "tab") { st.tab = el.dataset.tab; st.errors = []; render(); window.scrollTo(0, 0); return; }
      if (act === "pick-std") {
        st.std = Number(el.dataset.index);
        st.open.add(`iss-${st.std}-0`);
        render();
        return;
      }
      if (act === "save") { await save(); return; }
      if (act === "discard") {
        if (!isDirty() || confirm("ทิ้งการแก้ไขทั้งหมดที่ยังไม่บันทึก?")) { st.draft = JSON.parse(st.saved); st.errors = []; render(); }
        return;
      }
      if (act === "goto-edit") {
        if (!confirmDiscard()) return;
        await edit(el.dataset.year);
        st.tab = "standards";
        render();
        return;
      }
      if (act === "activate") {
        try {
          await app().run(() => app().store.setActiveYear(el.dataset.year), `ตั้งปีการศึกษา ${el.dataset.year} เป็นปีปัจจุบันแล้ว`);
          await app().refreshYears();
          await app().showYear(el.dataset.year);
          render();
        } catch (err) { /* toast */ }
        return;
      }
      if (act === "delete-year") {
        const y = el.dataset.year;
        if (!confirm(`ลบค่าตั้งค่าของปีการศึกษา ${y}? (ผลการประเมินและหลักฐานที่บันทึกไว้จะไม่ถูกลบ)`)) return;
        try {
          await app().run(() => app().store.deleteYear(y), `ลบปีการศึกษา ${y} แล้ว`);
          await app().refreshYears();
          if (st.year === y) await edit(app().years.active);
          render();
        } catch (err) { /* toast */ }
        return;
      }
      if (act === "export") {
        downloadJson(`iqa-config-${st.year}.json`, st.draft);
        return;
      }
      if (act === "backup") {
        el.disabled = true;
        try {
          const r = await app().run(() => backup($("#backup-year").value));
          app().toast(`สำรองข้อมูล ${r.years} ปีการศึกษา (${r.records} รายการ) แล้ว`, "ok");
        } catch (err) { /* toast แล้ว */ } finally { el.disabled = false; }
        return;
      }
      const listPath = el.dataset.list;
      if (!listPath) return;
      const list = getPath(st.draft, listPath);
      const k = Number(el.dataset.index);
      if (act === "add") {
        const kind = el.dataset.kind;
        const item = kind === "issue" ? newIssue(st.draft.standards[Number(el.dataset.std)]) : TEMPLATES[kind](list);
        list.push(item);
        if (kind === "standard") st.std = list.length - 1;
        if (kind === "issue") st.open.add(`iss-${el.dataset.std}-${list.length - 1}`);
      } else if (act === "up" || act === "down") {
        moveItem(list, k, act === "up" ? -1 : 1);
        if (listPath === "standards" && st.std === k) st.std = k + (act === "up" ? -1 : 1);
      }
      else if (act === "remove") {
        const label = listPath.endsWith("indicators") ? "ตัวชี้วัด" : listPath.endsWith("issues") ? "ประเด็นพิจารณา" : listPath === "standards" ? "มาตรฐาน" : "รายการ";
        if (!confirm(`ลบ${label}นี้?`)) return;
        const [removed] = list.splice(k, 1);
        // ลบการเชื่อมโยงที่อ้างถึงสิ่งที่ถูกลบ
        if (listPath === "goals") st.draft.strategies.forEach((s) => { s.goals = s.goals.filter((id) => id !== removed.id); });
        if (listPath === "standards") {
          st.draft.strategies.forEach((s) => { s.standards = s.standards.filter((c) => c !== removed.code); });
          st.std = Math.min(st.std, Math.max(0, list.length - 1));
        }
      }
      render();
    });

    root.addEventListener("submit", (e) => {
      if (e.target.dataset.form === "newyear") { e.preventDefault(); createYear(e.target); }
    });

    root.addEventListener("toggle", (e) => {
      const key = e.target.dataset && e.target.dataset.key;
      if (!key) return;
      if (e.target.open) { st.open.add(key); e.target.querySelectorAll("textarea").forEach(autosize); } else st.open.delete(key);
    }, true);

    window.addEventListener("beforeunload", (e) => {
      if (isDirty()) { e.preventDefault(); e.returnValue = ""; }
    });
  }

  window.IQAAdmin = { render, isDirty };
})();
