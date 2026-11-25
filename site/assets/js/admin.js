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
  const TABS = [["years", "ปีการศึกษา"], ["goals", "เป้าหมาย"], ["strategies", "กลยุทธ์"], ["standards", "มาตรฐาน ตัวชี้วัด ค่าเป้าหมาย"]];

  const st = { tab: "years", year: null, draft: null, saved: "", errors: [], open: new Set(["std-0"]), bound: false };

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
  function render() {
    const root = $("#admin-app");
    if (!root) return;
    bind(root);
    if (!st.draft || (st.year == null)) {
      root.innerHTML = `<p class="hint">กำลังโหลด…</p>`;
      edit(app().year).then(render);
      return;
    }
    const years = app().years.years;
    const editing = st.tab !== "years";
    root.innerHTML = `
      <div class="adm-bar">
        <div class="adm-tabs" role="tablist">${TABS.map(([k, label]) =>
          `<button type="button" role="tab" class="adm-tab ${st.tab === k ? "on" : ""}" aria-selected="${st.tab === k}" data-act="tab" data-tab="${k}">${label}</button>`).join("")}</div>
        ${editing ? `<div class="adm-save">
          <label class="adm-year">ปีการศึกษาที่แก้ไข
            <select data-act="edit-year">${years.map((y) => `<option value="${esc(y.year)}" ${y.year === st.year ? "selected" : ""}>${esc(y.year)}</option>`).join("")}</select></label>
          <span class="adm-dirty" id="adm-dirty" ${isDirty() ? "" : "hidden"}>มีการแก้ไขที่ยังไม่บันทึก</span>
          <button type="button" class="btn" data-act="discard">ยกเลิกการแก้ไข</button>
          <button type="button" class="btn primary" data-act="save">บันทึกปี ${esc(st.year)}</button>
        </div>` : ""}
      </div>
      ${st.errors.length ? `<div class="notice adm-errors" role="alert"><strong>ยังบันทึกไม่ได้ ${st.errors.length} รายการ</strong><ul>${st.errors.slice(0, 12).map((e) => `<li>${esc(e)}</li>`).join("")}${st.errors.length > 12 ? `<li>และอีก ${st.errors.length - 12} รายการ</li>` : ""}</ul></div>` : ""}
      <div class="adm-body">${({ years: renderYears, goals: renderGoals, strategies: renderStrategies, standards: renderStandards })[st.tab]()}</div>
      <datalist id="adm-units">${UNITS.map((u) => `<option value="${esc(u)}">`).join("")}</datalist>`;
  }

  // ---------- ปีการศึกษา
  function renderYears() {
    const Y = app().years;
    const rows = Y.years.map((y) => {
      const active = y.year === Y.active;
      const savedYet = Boolean(y.updatedAt);
      return `<tr>
        <th scope="row"><span class="code">${esc(y.year)}</span></th>
        <td>${active ? `<span class="badge lv5"><b>✓</b>ปีปัจจุบัน</span>` : `<span class="hint">—</span>`}</td>
        <td>${savedYet ? `${esc(new Date(y.updatedAt).toLocaleString("th-TH"))}${y.updatedBy ? `<small class="by">${esc(y.updatedBy)}</small>` : ""}` : `<span class="hint">ค่าตั้งต้นจากประกาศ (ยังไม่เคยบันทึก)</span>`}</td>
        <td class="adm-actions">
          <button type="button" class="btn" data-act="goto-edit" data-year="${esc(y.year)}">แก้ไข</button>
          ${active ? "" : `<button type="button" class="btn" data-act="activate" data-year="${esc(y.year)}" ${savedYet ? "" : "disabled title=\"บันทึกปีนี้ก่อน\""}>ตั้งเป็นปีปัจจุบัน</button>
          <button type="button" class="link danger" data-act="delete-year" data-year="${esc(y.year)}">ลบ</button>`}
        </td></tr>`;
    }).join("");
    return `
      <div class="table-wrap"><table>
        <thead><tr><th>ปีการศึกษา</th><th>สถานะ</th><th>แก้ไขล่าสุด</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <p class="hint">ปีปัจจุบันคือปีที่เว็บไซต์แสดงเป็นค่าเริ่มต้น ผู้ใช้เลือกดูปีอื่นได้จากตัวเลือกปีการศึกษาที่แถบด้านบน</p>

      <form class="panel adm-form" data-form="newyear">
        <h2>เพิ่มปีการศึกษา</h2>
        <div class="adm-grid">
          <label>ปีการศึกษา (พ.ศ.)<input name="year" inputmode="numeric" pattern="\\d{4}" maxlength="4" required placeholder="${esc(String(Number(Y.years[Y.years.length - 1].year) + 1))}"></label>
          <label>คัดลอกค่าตั้งค่าจาก
            <select name="from"><option value="">เริ่มต้นจากว่าง</option>${Y.years.map((y) => `<option value="${esc(y.year)}" ${y.year === Y.years[Y.years.length - 1].year ? "selected" : ""}>ปีการศึกษา ${esc(y.year)}</option>`).join("")}</select></label>
        </div>
        <label class="check"><input type="checkbox" name="useResults" checked>
          <span>ใช้ผลการประเมินของปีต้นทางเป็น "ผลปีก่อน" ของปีใหม่ (ระดับคุณภาพและค่าของตัวชี้วัดแต่ละตัว)</span></label>
        <div class="form-actions"><button class="btn primary" type="submit">สร้างปีการศึกษา</button></div>
      </form>

      <div class="panel adm-form">
        <h2>ส่งออก / นำเข้าค่าตั้งค่า</h2>
        <p class="hint">ไฟล์ JSON ของปีการศึกษาที่เลือก ใช้สำรองข้อมูลหรือย้ายไปเครื่องอื่น การนำเข้าจะแทนที่ฉบับร่าง ต้องกดบันทึกเพื่อใช้งาน</p>
        <div class="toolbar">
          <select data-act="io-year">${Y.years.map((y) => `<option value="${esc(y.year)}" ${y.year === st.year ? "selected" : ""}>ปีการศึกษา ${esc(y.year)}</option>`).join("")}</select>
          <button type="button" class="btn" data-act="export">ส่งออก JSON</button>
          <label class="btn file-btn">นำเข้า JSON<input type="file" accept="application/json" data-act="import" hidden></label>
        </div>
      </div>

      <div class="panel adm-form">
        <h2>สำรองข้อมูลทั้งหมด</h2>
        <p class="hint">ดาวน์โหลดไฟล์เดียวที่รวมค่าตั้งค่า (เป้าหมาย กลยุทธ์ มาตรฐาน ตัวชี้วัด ค่าเป้าหมาย) ผลการประเมิน ระดับที่คณะกรรมการตัดสิน จุดเด่น/จุดที่ควรพัฒนา และรายการหลักฐาน ควรสำรองหลังปิดรอบประเมินแต่ละครั้ง (ไฟล์หลักฐานจริงยังอยู่ใน Google Drive ตามลิงก์)</p>
        <div class="toolbar">
          <select id="backup-year" aria-label="ปีการศึกษาที่จะสำรอง">
            <option value="">ทุกปีการศึกษา</option>
            ${Y.years.map((y) => `<option value="${esc(y.year)}">ปีการศึกษา ${esc(y.year)}</option>`).join("")}
          </select>
          <button type="button" class="btn primary" data-act="backup">ดาวน์โหลดไฟล์สำรอง</button>
        </div>
      </div>`;
  }

  // ---------- เป้าหมาย
  const rowTools = (list, k, n) => `<span class="adm-tools">
      <button type="button" class="icon-btn" data-act="up" data-list="${list}" data-index="${k}" ${k === 0 ? "disabled" : ""} aria-label="เลื่อนขึ้น">↑</button>
      <button type="button" class="icon-btn" data-act="down" data-list="${list}" data-index="${k}" ${k === n - 1 ? "disabled" : ""} aria-label="เลื่อนลง">↓</button>
      <button type="button" class="icon-btn danger" data-act="remove" data-list="${list}" data-index="${k}" aria-label="ลบ">✕</button></span>`;

  function renderGoals() {
    const g = st.draft.goals;
    return `<div class="panel">
      <h2>เป้าหมาย ปีการศึกษา ${esc(st.year)}</h2>
      <p class="hint">อุดมการณ์และเป้าหมายการพัฒนาของโรงเรียน ใช้เชื่อมโยงกับกลยุทธ์</p>
      <div class="adm-list">${g.map((x, k) => `<div class="adm-row">
        <label class="adm-code">ข้อ<input data-bind="goals.${k}.code" value="${esc(x.code)}"></label>
        <label class="adm-grow">ข้อความ<textarea rows="2" data-bind="goals.${k}.text">${esc(x.text)}</textarea></label>
        ${rowTools("goals", k, g.length)}</div>`).join("") || `<p class="empty">ยังไม่มีเป้าหมาย</p>`}</div>
      <button type="button" class="btn" data-act="add" data-list="goals" data-kind="goal">+ เพิ่มเป้าหมาย</button>
    </div>`;
  }

  // ---------- กลยุทธ์
  function renderStrategies() {
    const ss = st.draft.strategies;
    const goals = st.draft.goals;
    const stds = st.draft.standards;
    return `<div class="panel">
      <h2>กลยุทธ์ ปีการศึกษา ${esc(st.year)}</h2>
      <p class="hint">เชื่อมโยงแต่ละกลยุทธ์กับเป้าหมายและมาตรฐานที่ขับเคลื่อน ใช้แสดงในหน้ามาตรฐาน</p>
      <div class="adm-list">${ss.map((x, k) => `<div class="adm-card">
        <div class="adm-row">
          <label class="adm-code">กลยุทธ์ที่<input data-bind="strategies.${k}.code" value="${esc(x.code)}"></label>
          <label class="adm-grow">ชื่อกลยุทธ์<textarea rows="2" data-bind="strategies.${k}.name">${esc(x.name)}</textarea></label>
          ${rowTools("strategies", k, ss.length)}
        </div>
        <fieldset class="adm-links"><legend>เชื่อมกับมาตรฐาน</legend>
          ${stds.map((s) => `<label class="pill"><input type="checkbox" data-toggle="strategies.${k}.standards" value="${esc(s.code)}" ${x.standards.includes(s.code) ? "checked" : ""}> มาตรฐานที่ ${esc(s.code)}</label>`).join("") || `<span class="hint">ยังไม่มีมาตรฐาน</span>`}
        </fieldset>
        <fieldset class="adm-links"><legend>เชื่อมกับเป้าหมาย</legend>
          ${goals.map((g) => `<label class="pill" title="${esc(g.text)}"><input type="checkbox" data-toggle="strategies.${k}.goals" value="${esc(g.id)}" ${x.goals.includes(g.id) ? "checked" : ""}> เป้าหมาย ${esc(g.code)}</label>`).join("") || `<span class="hint">ยังไม่มีเป้าหมาย</span>`}
        </fieldset>
      </div>`).join("") || `<p class="empty">ยังไม่มีกลยุทธ์</p>`}</div>
      <button type="button" class="btn" data-act="add" data-list="strategies" data-kind="strategy">+ เพิ่มกลยุทธ์</button>
    </div>`;
  }

  // ---------- มาตรฐาน ตัวชี้วัด ค่าเป้าหมาย
  function renderStandards() {
    const stds = st.draft.standards;
    return `
      <p class="hint">กำหนดมาตรฐาน ประเด็นพิจารณา ตัวชี้วัด ค่าเป้าหมาย และเกณฑ์การตัดสินของปีการศึกษา ${esc(st.year)} ผลการประเมินที่บันทึกไว้ผูกกับตัวชี้วัดแต่ละตัว จัดเรียงใหม่ได้โดยผลไม่เปลี่ยน แต่หากลบตัวชี้วัด ผลของตัวชี้วัดนั้นจะไม่แสดงอีก</p>
      ${stds.map((s, si) => renderStandard(s, si, stds.length)).join("") || `<p class="empty">ยังไม่มีมาตรฐาน</p>`}
      <button type="button" class="btn" data-act="add" data-list="standards" data-kind="standard">+ เพิ่มมาตรฐาน</button>`;
  }

  function renderStandard(s, si, n) {
    const P = `standards.${si}`;
    const bandsKey = s.method === "checklist" ? "scoreBands" : "bands";
    const bands = s[bandsKey] || [];
    const rv = s.review || {};
    return `<details class="panel adm-std" data-key="std-${si}" ${st.open.has(`std-${si}`) ? "open" : ""}>
      <summary><span class="std-no">มาตรฐานที่ ${esc(s.code)}</span> ${esc(s.name) || `<span class="hint">ยังไม่มีชื่อ</span>`} <small>${s.issues.length} ประเด็น</small></summary>
      <div class="adm-std-head">
        <div class="adm-grid">
          <label class="adm-code">รหัส<input data-bind="${P}.code" value="${esc(s.code)}"></label>
          <label class="adm-grow">ชื่อมาตรฐาน<input data-bind="${P}.name" value="${esc(s.name)}"></label>
          <label>วิธีตัดสินระดับคุณภาพ<select data-act="method" data-std="${si}">${Object.entries(METHODS).map(([k, v]) => `<option value="${k}" ${s.method === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
          <label>ค่าเป้าหมายระดับมาตรฐาน<input data-bind="${P}.targetText" value="${esc(s.targetText)}" placeholder="เช่น ยอดเยี่ยม (ร้อยละ 90.81)"></label>
          <label>ผลปี ${esc(st.draft.previousYear)}<select data-bind="${P}.prev.level" data-type="level">${levelOptions(s.prev && s.prev.level)}</select></label>
          <label>นวัตกรรม/วิธีปฏิบัติที่เป็นเลิศ<input data-bind="${P}.model" value="${esc(s.model)}"></label>
        </div>
        <label>จุดเน้น<textarea rows="2" data-bind="${P}.focus">${esc(s.focus)}</textarea></label>
        <label>คำอธิบายเกณฑ์การตัดสิน (แสดงในหน้ามาตรฐาน)<textarea rows="2" data-bind="${P}.criteria">${esc(s.criteria)}</textarea></label>
        <fieldset class="adm-bands"><legend>เกณฑ์ระดับคุณภาพ — ${s.method === "checklist" ? "คะแนนรวมขั้นต่ำ" : s.method === "achievement" ? "ร้อยละความสำเร็จขั้นต่ำ" : "ค่าร้อยละขั้นต่ำ"}</legend>
          ${bands.filter((b) => b.level > 1).map((b) => {
            const k = bands.indexOf(b);
            return `<label><span class="badge lv${b.level}"><b>${b.level}</b>${LEVEL_NAMES[b.level]}</span><input type="number" step="any" data-type="num" data-bind="${P}.${bandsKey}.${k}.min" value="${esc(b.min)}"></label>`;
          }).join("")}
          <span class="hint">ต่ำกว่าระดับปานกลาง = กำลังพัฒนา</span>
        </fieldset>
        <details class="adm-sub" data-key="rv-${si}" ${st.open.has(`rv-${si}`) ? "open" : ""}><summary>สรุปจาก SAR ปีก่อน (จุดเด่น / จุดที่ควรพัฒนา / ข้อเสนอแนะ)</summary>
          <div class="adm-grid three">
            <label>จุดเด่น (บรรทัดละข้อ)<textarea rows="4" data-type="lines" data-bind="${P}.review.strengths">${esc((rv.strengths || []).join("\n"))}</textarea></label>
            <label>จุดที่ควรพัฒนา<textarea rows="4" data-type="lines" data-bind="${P}.review.improve">${esc((rv.improve || []).join("\n"))}</textarea></label>
            <label>ข้อเสนอแนะ<textarea rows="4" data-type="lines" data-bind="${P}.review.suggest">${esc((rv.suggest || []).join("\n"))}</textarea></label>
          </div>
        </details>
        <div class="adm-std-tools">${rowTools("standards", si, n)}</div>
      </div>
      <h3 class="adm-h">ประเด็นพิจารณา</h3>
      ${s.issues.map((i, ii) => renderIssue(s, si, i, ii)).join("") || `<p class="empty">ยังไม่มีประเด็นพิจารณา</p>`}
      <button type="button" class="btn" data-act="add" data-list="${P}.issues" data-kind="issue" data-std="${si}">+ เพิ่มประเด็นพิจารณา</button>
    </details>`;
  }

  function renderIssue(s, si, i, ii) {
    const P = `standards.${si}.issues.${ii}`;
    const kind = i.rubric ? "rubric" : i.checklist ? "checklist" : "indicators";
    let body = "";
    if (kind === "indicators") {
      body = `<div class="table-wrap"><table class="adm-table">
        <thead><tr><th>ตัวชี้วัด</th><th class="num">ค่าเป้าหมาย</th><th>หน่วย</th><th>ทิศทาง</th><th class="num">ผลปี ${esc(st.draft.previousYear)}</th><th></th></tr></thead>
        <tbody>${i.indicators.map((ind, k) => `<tr>
          <td><textarea rows="2" data-bind="${P}.indicators.${k}.name" aria-label="ชื่อตัวชี้วัด">${esc(ind.name)}</textarea></td>
          <td><input type="number" step="any" min="0" class="num-in" data-type="num" data-bind="${P}.indicators.${k}.target" value="${esc(ind.target ?? "")}" aria-label="ค่าเป้าหมาย"></td>
          <td><input list="adm-units" class="unit-in" data-bind="${P}.indicators.${k}.unit" value="${esc(ind.unit || "%")}" aria-label="หน่วย"></td>
          <td><select data-bind="${P}.indicators.${k}.dir" aria-label="ทิศทาง"><option value="max" ${ind.dir !== "min" ? "selected" : ""}>ไม่น้อยกว่า</option><option value="min" ${ind.dir === "min" ? "selected" : ""}>ไม่เกิน</option></select></td>
          <td><input type="number" step="any" min="0" class="num-in" data-type="num" data-bind="${P}.indicators.${k}.prev" value="${esc(ind.prev ?? "")}" placeholder="ใหม่" aria-label="ผลปีก่อน"></td>
          <td>${rowTools(`${P}.indicators`, k, i.indicators.length)}</td></tr>`).join("")
          || `<tr><td colspan="6" class="empty">ยังไม่มีตัวชี้วัด</td></tr>`}</tbody></table></div>
        <button type="button" class="btn small" data-act="add" data-list="${P}.indicators" data-kind="indicator">+ เพิ่มตัวชี้วัด</button>`;
    } else if (kind === "checklist") {
      body = `<ol class="adm-checks">${i.checklist.map((c, k) => `<li class="adm-row">
          <label class="adm-grow"><span class="sr-only">รายการที่ ${k + 1}</span><textarea rows="2" data-bind="${P}.checklist.${k}.text">${esc(c.text)}</textarea></label>
          ${rowTools(`${P}.checklist`, k, i.checklist.length)}</li>`).join("") || `<li class="empty">ยังไม่มีรายการ</li>`}</ol>
        <button type="button" class="btn small" data-act="add" data-list="${P}.checklist" data-kind="check">+ เพิ่มรายการประเมิน</button>`;
    } else {
      body = `<div class="adm-rubric">${[4, 3, 2, 1, 0].map((k) => `<label><span class="badge lv${k + 1}"><b>${k + 1}</b>${LEVEL_NAMES[k + 1]}</span>
          <textarea rows="2" data-bind="${P}.rubric.${k}">${esc(i.rubric[k])}</textarea></label>`).join("")}</div>`;
    }
    return `<div class="adm-issue">
      <div class="adm-row">
        <label class="adm-code">รหัส<input data-bind="${P}.code" value="${esc(i.code)}"></label>
        <label class="adm-grow">ประเด็นพิจารณา<textarea rows="2" data-bind="${P}.name">${esc(i.name)}</textarea></label>
        <label>ผลปี ${esc(st.draft.previousYear)}<select data-bind="${P}.prevLevel" data-type="level">${levelOptions(i.prevLevel)}</select></label>
        ${s.method === "checklist" ? `<label>รูปแบบ<select data-act="issue-kind" data-path="${P}">
          <option value="checklist" ${kind === "checklist" ? "selected" : ""}>รายการตรวจสอบ</option>
          <option value="rubric" ${kind === "rubric" ? "selected" : ""}>เลือกระดับ (rubric)</option></select></label>` : ""}
        ${rowTools(`standards.${si}.issues`, ii, s.issues.length)}
      </div>
      ${body}
    </div>`;
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
      if (act === "tab") { st.tab = el.dataset.tab; st.errors = []; render(); return; }
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
        if (kind === "standard") st.open.add(`std-${list.length - 1}`);
      } else if (act === "up") moveItem(list, k, -1);
      else if (act === "down") moveItem(list, k, 1);
      else if (act === "remove") {
        const label = listPath.endsWith("indicators") ? "ตัวชี้วัด" : listPath.endsWith("issues") ? "ประเด็นพิจารณา" : listPath === "standards" ? "มาตรฐาน" : "รายการ";
        if (!confirm(`ลบ${label}นี้?`)) return;
        const [removed] = list.splice(k, 1);
        // ลบการเชื่อมโยงที่อ้างถึงสิ่งที่ถูกลบ
        if (listPath === "goals") st.draft.strategies.forEach((s) => { s.goals = s.goals.filter((id) => id !== removed.id); });
        if (listPath === "standards") st.draft.strategies.forEach((s) => { s.standards = s.standards.filter((c) => c !== removed.code); });
      }
      render();
    });

    root.addEventListener("submit", (e) => {
      if (e.target.dataset.form === "newyear") { e.preventDefault(); createYear(e.target); }
    });

    root.addEventListener("toggle", (e) => {
      const key = e.target.dataset && e.target.dataset.key;
      if (!key) return;
      if (e.target.open) st.open.add(key); else st.open.delete(key);
    }, true);

    window.addEventListener("beforeunload", (e) => {
      if (isDirty()) { e.preventDefault(); e.returnValue = ""; }
    });
  }

  window.IQAAdmin = { render, isDirty };
})();
