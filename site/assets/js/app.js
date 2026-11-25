(function () {
  "use strict";

  const BASE = window.IQA_DATA;
  const M = window.IQAModel;
  const store = window.IQAStore;
  // ค่าตั้งค่าของปีการศึกษาที่กำลังแสดง (โหลดจาก store หรือค่าตั้งต้นใน data.js)
  let D = BASE;
  let CFG = null;
  let AY = BASE.school.academicYear;
  let PY = BASE.school.previousYear;
  let YEARS = { active: AY, years: [{ year: AY }] };
  let issues = [];
  let issueByCode = {};
  let stdOf = {};
  const PHASE_NAME = { P: "วางแผน", D: "ดำเนินการ", C: "ประเมิน", A: "ปรับปรุง" };
  const GATED = new Set(["evidence", "assessment", "reports"]);

  // ข้อมูลที่โหลดจาก store (Google Sheets หรือ localStorage)
  const S = { evidence: [], results: {}, verdicts: {}, notes: {}, loaded: false };

  // ---------- helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const levelInfo = (n) => D.levels.find((l) => l.level === n);
  // คีย์ผลการประเมิน: รหัสประเด็น + id ของตัวชี้วัด/รายการ (rubric ใช้ id "0")
  const indKey = (issue, item) => `${issue.code}#${item.id}`;
  const RUBRIC = { id: "0" };

  function setModel(cfg) {
    CFG = cfg;
    D = { ...BASE, goals: cfg.goals, strategies: cfg.strategies, standards: cfg.standards,
      school: { ...BASE.school, academicYear: cfg.academicYear, previousYear: cfg.previousYear } };
    AY = cfg.academicYear;
    PY = cfg.previousYear || String(Number(AY) - 1);
    issues = D.standards.flatMap((s) => s.issues.map((i) => ({ ...i, std: s })));
    issueByCode = Object.fromEntries(issues.map((i) => [i.code, i]));
    stdOf = Object.fromEntries(issues.map((i) => [i.code, i.std]));
  }
  const signedIn = () => Boolean(store.user);
  const can = (perm) => store.can(perm);

  let toastTimer;
  function toast(msg, kind = "") {
    const el = $("#toast");
    el.textContent = msg;
    el.className = `toast show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = "toast"; }, kind === "error" ? 6000 : 2500);
  }

  async function run(task, okMsg) {
    try {
      const out = await task();
      if (okMsg) toast(okMsg, "ok");
      return out;
    } catch (e) {
      toast(e.message || String(e), "error");
      throw e;
    }
  }

  async function reload() {
    if (!signedIn()) {
      Object.assign(S, { evidence: [], results: {}, verdicts: {}, notes: {}, loaded: false });
      return;
    }
    $("#main").setAttribute("aria-busy", "true");
    try {
      const data = await store.load();
      Object.assign(S, { evidence: data.evidence || [], results: data.results || {}, verdicts: data.verdicts || {}, notes: data.notes || {}, loaded: true });
    } catch (e) {
      toast("โหลดข้อมูลไม่สำเร็จ: " + e.message, "error");
    } finally {
      $("#main").removeAttribute("aria-busy");
    }
  }

  // ---------- ระดับคุณภาพ (ตามประกาศค่าเป้าหมายของโรงเรียน) ----------
  const has = (v) => v !== "" && v != null && !isNaN(v);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const band = (bands, value) => (value == null ? null : (bands.find((b) => value >= b.min) || bands[bands.length - 1]).level);
  const itemsOf = (issue) => issue.indicators || issue.checklist || issue.rubric || [];

  // ร้อยละความสำเร็จเทียบกับค่าเป้าหมาย (ไม่เกิน 100) — ใช้กับมาตรฐานแบบ achievement
  function achievement(ind, v) {
    if (!has(v) || !ind.target) return null;
    v = Number(v);
    if (ind.dir === "min") return v <= ind.target ? 100 : (ind.target / v) * 100;
    return Math.min(100, (v / ind.target) * 100);
  }
  const metTarget = (ind, v) => (has(v) ? (ind.dir === "min" ? Number(v) <= ind.target : Number(v) >= ind.target) : null);

  // ผลรายประเด็น: { value, label, level }
  function issueScore(issue, results = S.results) {
    const std = stdOf[issue.code];
    if (issue.checklist) {
      const vals = issue.checklist.map((it) => results[indKey(issue, it)]);
      if (!vals.some(has)) return { value: null, level: null };
      const count = vals.filter((v) => Number(v) === 1).length;
      return { value: count, label: `${count}/${issue.checklist.length} ข้อ`, level: Math.max(1, count) };
    }
    if (issue.rubric) {
      const v = results[indKey(issue, RUBRIC)];
      return has(v) ? { value: Number(v), label: `ระดับ ${v}`, level: Number(v) } : { value: null, level: null };
    }
    if (std.method === "achievement") {
      const value = mean(issue.indicators.map((ind) => achievement(ind, results[indKey(issue, ind)])).filter((x) => x != null));
      return { value, label: value == null ? "" : `สำเร็จ ${fmt(value)}%`, level: band(std.bands, value) };
    }
    const value = mean(issue.indicators.map((ind) => results[indKey(issue, ind)]).filter(has).map(Number));
    return { value, label: value == null ? "" : `ร้อยละ ${fmt(value)}`, level: band(std.bands, value) };
  }
  const issueSuggested = (issue) => issueScore(issue).level;
  function issueLevel(issue, verdicts = S.verdicts) {
    const v = verdicts[issue.code];
    return v ? Number(v) : issueSuggested(issue);
  }
  // ผลรายมาตรฐาน: { label, level }
  function standardScore(std) {
    if (std.method === "checklist") {
      const lv = std.issues.map(issueLevel).filter((x) => x != null);
      if (!lv.length) return { label: "", level: null };
      const total = lv.reduce((a, b) => a + b, 0);
      return { label: `คะแนน ${total}/${std.issues.length * 5}`, level: band(std.scoreBands, total) };
    }
    const value = mean(std.issues.map((i) => issueScore(i).value).filter((x) => x != null));
    if (value == null) return { label: "", level: null };
    return { label: std.method === "achievement" ? `สำเร็จ ${fmt(value)}%` : `ร้อยละ ${fmt(value)}`, level: band(std.bands, value) };
  }
  const standardLevel = (std) => standardScore(std).level;
  const issueTarget = (issue) => (issue.indicators && stdOf[issue.code].method === "percent" ? mean(issue.indicators.map((x) => x.target)) : null);

  function fmt(v) { return v === "" || v == null ? "—" : Number(v).toLocaleString("th-TH", { maximumFractionDigits: 2 }); }
  const fmtInd = (ind, v) => (v === "" || v == null ? "—" : ind.unit && ind.unit !== "%" ? `${fmt(v)} ${ind.unit}` : fmt(v));
  const fmtTarget = (ind) => (ind.dir === "min" ? `≤ ${fmtInd(ind, ind.target)}` : fmtInd(ind, ind.target));

  function levelBadge(n) {
    if (!n) return `<span class="badge lv0">ยังไม่ประเมิน</span>`;
    return `<span class="badge lv${n}"><b>${n}</b>${esc(levelInfo(n).name)}</span>`;
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  // ---------- auth UI ----------
  function renderAuth() {
    const area = $("#auth-area");
    const u = store.user;
    if (store.mode === "local") {
      area.innerHTML = `<span class="mode-chip" title="ยังไม่ได้เชื่อม Google Sheets — ข้อมูลอยู่ในเบราว์เซอร์นี้เท่านั้น">โหมดทดลอง</span>`;
      return;
    }
    if (u) {
      area.innerHTML = `<div class="user-chip">
        ${u.picture ? `<img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : ""}
        <span><strong>${esc(u.name)}</strong><small>${esc(store.roleName(u.role))}</small></span>
        <button class="link" id="sign-out" type="button">ออกจากระบบ</button></div>`;
      $("#sign-out").addEventListener("click", () => store.signOut());
    } else {
      area.innerHTML = `<div id="gsi-header"></div>`;
      store.renderButton($("#gsi-header"));
    }
  }

  function applyPermissions() {
    $("#evidence-form").hidden = !can("evidence:add");
    $("#ev-import-label").hidden = !(store.mode === "local" || can("admin"));
    $("#as-clear").hidden = !can("admin");
    $$(".admin-only").forEach((el) => { el.hidden = !can("admin"); });
    $$(".local-only").forEach((el) => { el.hidden = store.mode !== "local"; });
    $$(".remote-only").forEach((el) => { el.hidden = store.mode !== "remote"; });
  }

  // ---------- หน้าแรก ----------
  const TH_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
  const PHASE_ARC = { P: [-90, 0], D: [0, 90], C: [90, 180], A: [180, 270] };

  function inMonths(m, [a, b]) { return a <= b ? m >= a && m <= b : m >= a || m <= b; }

  function polar(r, deg) {
    const t = (deg * Math.PI) / 180;
    return [160 + r * Math.cos(t), 160 + r * Math.sin(t)];
  }

  // วงจร PDCA พร้อมตำแหน่งปัจจุบันของปีการศึกษา (คำนวณจากเดือนปัจจุบันกับปฏิทินใน data.js)
  function renderCycle() {
    const month = new Date().getMonth() + 1;
    const now = D.calendar.filter((c) => c.months && inMonths(month, c.months));
    const active = new Set(now.flatMap((c) => c.steps));
    const activePhases = new Set(D.pdca.filter((p) => active.has(p.step)).map((p) => p.phase));

    // วางขั้นตอนบนวง: กระจายขั้นของแต่ละ phase ให้เท่ากันภายในส่วนโค้งของ phase นั้น
    const marks = [];
    Object.entries(PHASE_ARC).forEach(([ph, [a, b]]) => {
      const steps = D.pdca.filter((p) => p.phase === ph);
      steps.forEach((p, i) => marks.push({ p, deg: a + ((b - a) * (i + 1)) / (steps.length + 1) }));
    });

    const R = 118;
    const arcs = Object.entries(PHASE_ARC).map(([ph, [a, b]], i) => {
      const [x1, y1] = polar(R, a + 3);
      const [x2, y2] = polar(R, b - 3);
      const [lx, ly] = polar(R + 30, (a + b) / 2);
      return `<path class="arc ${activePhases.has(ph) ? "on" : ""}" style="--i:${i}" pathLength="1" d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${R} ${R} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}"/>
        <text class="arc-label ${activePhases.has(ph) ? "on" : ""}" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}">${ph}</text>`;
    }).join("");
    const dots = marks.map(({ p, deg }) => {
      const [x, y] = polar(R, deg);
      return `<g class="mark ${active.has(p.step) ? "on" : ""}"><title>ขั้นที่ ${p.step} ${esc(p.title)}</title>
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13"/><text x="${x.toFixed(1)}" y="${y.toFixed(1)}">${p.step}</text></g>`;
    }).join("");

    const stepNames = D.pdca.filter((p) => active.has(p.step));
    $("#cycle").innerHTML = `
      <svg viewBox="0 0 320 320" role="img" aria-label="วงจร PDCA ของปีการศึกษา">
        <circle class="orbit" cx="160" cy="160" r="${R - 26}"/>
        ${arcs}${dots}
        <text class="c-small" x="160" y="138">ขณะนี้</text>
        <text class="c-month" x="160" y="168">${TH_MONTHS[month - 1]}</text>
        <text class="c-small" x="160" y="194">${stepNames.length ? "ขั้นที่ " + stepNames.map((p) => p.step).join(" และ ") : ""}</text>
      </svg>
      <figcaption id="cycle-caption">${now.length ? now.map((c) => esc(c.activity)).join("<br>") : "ดูปฏิทินการดำเนินงานในหน้ากระบวนการ"}</figcaption>`;
  }

  function renderHome() {
    const ev = S.evidence;
    const assessed = issues.filter((i) => issueLevel(i) != null).length;
    const covered = issues.filter((i) => ev.some((e) => e.issue === i.code)).length;
    const locked = store.mode === "remote" && !signedIn();
    renderCycle();

    $("#home-standards").innerHTML = D.standards.map((s) => {
      const lv = locked ? null : standardLevel(s);
      return `<a class="std-cell" href="#assessment">
        <span class="std-no">มาตรฐานที่ ${s.code}</span>
        <span class="std-name">${esc(s.name)}</span>
        <span class="meter" aria-hidden="true">${[1, 2, 3, 4, 5].map((n) => `<i class="${lv && n <= lv ? "lv" + lv : ""}"></i>`).join("")}</span>
        ${levelBadge(lv)}
        <span class="std-prev">เป้าหมาย ${esc(s.targetText || "—")}<br>ปี ${PY}: ${s.prev ? esc(levelInfo(s.prev.level).name) : "—"}</span>
      </a>`;
    }).join("");

    const sc = D.school;
    $("#home-identity").innerHTML = `
      <blockquote class="vision"><p>${esc(sc.vision)}</p><cite>วิสัยทัศน์</cite></blockquote>
      <dl class="identity">
        <div><dt>เอกลักษณ์ของโรงเรียน</dt><dd>${esc(sc.schoolIdentity)}</dd></div>
        <div><dt>อัตลักษณ์ของนักเรียน</dt><dd>${esc(sc.studentIdentity)}</dd></div>
        <div><dt>คำขวัญ</dt><dd>${esc(sc.motto)}</dd></div>
        <div><dt>ปรัชญา</dt><dd>${esc(sc.philosophy)}</dd></div>
      </dl>`;

    $("#home-stats").innerHTML = [
      [locked ? "—" : ev.length, "หลักฐานในคลัง"],
      [locked ? "—" : `${covered}/${issues.length}`, "ประเด็นที่มีหลักฐาน"],
      [locked ? "—" : `${assessed}/${issues.length}`, "ประเด็นที่ประเมินแล้ว"],
    ].map(([v, k]) => `<div class="stat"><strong>${v}</strong><span>${k}</span></div>`).join("");
    $("#home-locked").hidden = !locked;

    $("#home-steps").innerHTML = D.pdca.map((p) =>
      `<li><span class="seq-no">${p.step}</span><span class="phase ph-${p.phase}">${p.phase}</span><span class="seq-title">${esc(p.title)}</span></li>`).join("");
  }

  // ---------- ข้อมูลโรงเรียน ----------
  function renderSchool() {
    const sc = D.school;
    $("#school-profile").innerHTML = [...sc.profile, ["คำขวัญ", sc.motto], ["ปรัชญา", sc.philosophy], ["วิสัยทัศน์", sc.vision],
      ["เอกลักษณ์ของโรงเรียน", sc.schoolIdentity], ["อัตลักษณ์ของนักเรียน", sc.studentIdentity]]
      .map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("");

    $("#school-symbols").innerHTML = `
      <section class="panel sym">
        <h3>สีประจำโรงเรียน</h3>
        <div class="swatches">${sc.colors.map((c) => `<div class="swatch"><i style="background:${c.hex}"></i><div><strong>${esc(c.name)}</strong><span>${esc(c.meaning)}</span></div></div>`).join("")}</div>
      </section>
      <section class="panel sym">
        <h3>ค่านิยมองค์กร ${esc(sc.values.name)}</h3>
        <dl class="values">${sc.values.items.map(([l, en, th]) => `<div><dt>${esc(l)}</dt><dd><strong>${esc(en)}</strong><span>${esc(th)}</span></dd></div>`).join("")}</dl>
      </section>
      <section class="panel sym">
        <h3>ตราประจำโรงเรียน</h3>
        <p>${esc(sc.crest[0])}</p>
        <ul>${sc.crest.slice(1).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      </section>
      <section class="panel sym">
        <h3>ต้นไม้ประจำโรงเรียน: ${esc(sc.tree.name)}</h3>
        <dl class="facts">${sc.tree.facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
      </section>`;

    const A = D.admin;
    $("#admin-structure").innerHTML = `
      <div class="admin">
        <div class="admin-top">
          <ul class="admin-side">${A.boards.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
          <div class="admin-head">${esc(A.head)}</div>
          <ul class="admin-side partners">${A.partners.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        </div>
        <ol class="admin-groups">${A.groups.map((g) => `
          <li class="admin-group"><h3>${esc(g.name)}</h3>
            ${g.sections.map((sec) => `<div class="admin-sec"><h4>${esc(sec.name)}</h4>
              <ol>${sec.units.map((u) => `<li class="${/ประกันคุณภาพ/.test(u) ? "hl" : ""}">${esc(u)}</li>`).join("")}</ol></div>`).join("")}
          </li>`).join("")}</ol>
      </div>`;
  }

  // ---------- โครงสร้าง ----------
  function renderStructure() {
    $("#org-standards").innerHTML = D.standards.map((s) =>
      `<div class="org-node small">คณะทำงานมาตรฐานที่ ${s.code}<small>${esc(s.name)}</small></div>`).join("");
    $("#roles-table tbody").innerHTML = D.roles.map((r) =>
      `<tr><th scope="row">${esc(r.unit)}</th><td>${esc(r.duty)}</td><td>${esc(r.output)}</td></tr>`).join("");
  }

  // ---------- มาตรฐาน ----------
  function renderStandards() {
    const list = (title, items) => items && items.length
      ? `<div><h4>${title}</h4><ol>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></div>` : "";
    const rows = (s, i) => {
      if (i.checklist) {
        return i.checklist.map((t, k) => `<tr>${k === 0 ? `<td rowspan="${i.checklist.length}" class="issue-cell"><span class="code">${i.code}</span> ${esc(i.name)}</td>` : ""}
          <td>${i.code}.${k + 1} ${esc(t.text)}</td>${k === 0 ? `<td rowspan="${i.checklist.length}" class="num">ยอดเยี่ยม<br><small class="hint">ครบ 5 ข้อ</small></td><td rowspan="${i.checklist.length}" class="num">${i.prevLevel ? esc(levelInfo(i.prevLevel).name) : "—"}</td>` : ""}</tr>`).join("");
      }
      if (i.rubric) {
        return `<tr><td class="issue-cell"><span class="code">${i.code}</span> ${esc(i.name)}</td>
          <td><ol class="rubric-list" reversed>${i.rubric.slice().reverse().map((t, k) => `<li><b>${esc(levelInfo(5 - k).name)}</b> ${esc(t)}</li>`).join("")}</ol></td>
          <td class="num">ยอดเยี่ยม</td><td class="num">${i.prevLevel ? esc(levelInfo(i.prevLevel).name) : "—"}</td></tr>`;
      }
      const it = issueTarget(i);
      return i.indicators.map((ind, k) => {
        const below = ind.prev != null && metTarget(ind, ind.prev) === false;
        return `<tr>${k === 0 ? `<td rowspan="${i.indicators.length}" class="issue-cell"><span class="code">${i.code}</span> ${esc(i.name)}${it != null ? `<small class="hint">เป้าหมายประเด็น ร้อยละ ${fmt(it)}</small>` : ""}</td>` : ""}
          <td>${esc(ind.name)}</td><td class="num">${fmtTarget(ind)}</td>
          <td class="num ${below ? "below" : ""}">${ind.prev == null ? `<span class="hint">ตัวชี้วัดใหม่</span>` : fmtInd(ind, ind.prev)}</td></tr>`;
      }).join("");
    };
    $("#standards-list").innerHTML = D.standards.map((s) => `
      <details class="panel std" ${s.code === "1" ? "open" : ""}>
        <summary><span class="std-no">มาตรฐานที่ ${s.code}</span> ${esc(s.name)} <small>${s.issues.length} ประเด็น</small></summary>
        <div class="std-meta">
          <div><span class="meta-k">ค่าเป้าหมายปี ${AY}</span><strong>${esc(s.targetText || "—")}</strong></div>
          <div><span class="meta-k">นวัตกรรม/วิธีปฏิบัติที่เป็นเลิศ</span><strong>${esc(s.model || "—")}</strong></div>
          <div><span class="meta-k">ผลปี ${PY}</span>${s.prev ? levelBadge(s.prev.level) : "—"}</div>
        </div>
        <p class="criteria"><span class="meta-k">เกณฑ์การตัดสิน</span>${esc(s.criteria || "")}</p>
        <div class="table-wrap"><table>
          <thead><tr><th>ประเด็น</th><th>${s.method === "checklist" ? "รายการประเมิน" : "ตัวชี้วัด"}</th><th class="num">ค่าเป้าหมายปี ${AY}</th><th class="num">ผลปี ${PY}</th></tr></thead>
          <tbody>${s.issues.map((i) => rows(s, i)).join("")}</tbody></table></div>
        ${s.review ? `<div class="review"><p class="review-title">สรุปจาก SAR ปีการศึกษา ${PY}</p>
          <div class="review-grid">${list("จุดเด่น", s.review.strengths)}${list("จุดที่ควรพัฒนา", s.review.improve)}${list("ข้อเสนอแนะ", s.review.suggest)}</div></div>` : ""}
      </details>`).join("");

    // เกณฑ์ระดับคุณภาพ สร้างจากค่าเกณฑ์ของแต่ละมาตรฐานในปีที่แสดง
    const legendLine = (s, lv) => {
      const bands = (s.method === "checklist" ? s.scoreBands : s.bands) || [];
      const b = bands.find((x) => x.level === lv);
      if (!b) return "";
      const what = s.method === "checklist" ? `คะแนนรวม ${fmt(b.min)} ขึ้นไป` : s.method === "achievement" ? `สำเร็จร้อยละ ${fmt(b.min)} ขึ้นไป` : `ร้อยละ ${fmt(b.min)} ขึ้นไป`;
      return `มาตรฐานที่ ${esc(s.code)}: ${what}`;
    };
    $("#levels-legend").innerHTML = [5, 4, 3, 2, 1].map((lv) =>
      `<div class="level-item">${levelBadge(lv)}<p>${D.standards.map((s) => legendLine(s, lv)).filter(Boolean).join("<br>") || "—"}</p></div>`).join("");

    renderPlan();
  }

  // เป้าหมายและกลยุทธ์ของปีการศึกษา
  function renderPlan() {
    const goals = D.goals || [];
    const strategies = D.strategies || [];
    const goalCode = Object.fromEntries(goals.map((g) => [g.id, g.code]));
    $("#plan").hidden = !goals.length && !strategies.length;
    $("#plan-goals").innerHTML = goals.map((g) => `<li><span class="plan-no">${esc(g.code)}</span><span>${esc(g.text)}</span></li>`).join("")
      || `<li class="hint">ยังไม่ได้กำหนดเป้าหมาย</li>`;
    $("#plan-strategies").innerHTML = strategies.map((st) => `<li><span class="plan-no">${esc(st.code)}</span><span>${esc(st.name)}
        ${st.goals.length || st.standards.length ? `<span class="plan-links">${st.standards.map((c) => `<span class="chip">มาตรฐานที่ ${esc(c)}</span>`).join("")}${st.goals.map((id) => goalCode[id] ? `<span class="chip">เป้าหมาย ${esc(goalCode[id])}</span>` : "").join("")}</span>` : ""}</span></li>`).join("")
      || `<li class="hint">ยังไม่ได้กำหนดกลยุทธ์</li>`;
  }

  // ---------- กระบวนการ ----------
  function renderProcess() {
    $("#process-list").innerHTML = D.pdca.map((p) => `
      <div class="panel step">
        <div class="step-head"><span class="step-no">${p.step}</span><span class="phase ph-${p.phase}">${p.phase} ${PHASE_NAME[p.phase]}</span></div>
        <h3>${esc(p.title)}</h3>
        <ul>${p.tasks.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
        <dl><dt>ผู้รับผิดชอบ</dt><dd>${esc(p.owner)}</dd><dt>ผลผลิต</dt><dd>${esc(p.output)}</dd></dl>
      </div>`).join("");

    $("#calendar-list").innerHTML = D.calendar.map((c) => `
      <div class="tl-item">
        <div class="tl-period">${esc(c.period)}</div>
        <div class="tl-body"><div class="tl-steps">${c.steps.map((s) => `<span class="chip">ขั้นที่ ${s}</span>`).join("")}</div>${esc(c.activity)}</div>
      </div>`).join("");
  }

  // ---------- คลังหลักฐาน ----------
  function fillEvidenceOptions() {
    $("#evidence-form select[name=issue]").innerHTML = D.standards.map((s) =>
      `<optgroup label="มาตรฐานที่ ${esc(s.code)} ${esc(s.name)}">${s.issues.map((i) =>
        `<option value="${esc(i.code)}">${esc(i.code)} ${esc(i.name)}</option>`).join("")}</optgroup>`).join("");
    $("#ev-filter-std").innerHTML = `<option value="">ทุกมาตรฐาน</option>` + D.standards.map((s) => `<option value="${esc(s.code)}">มาตรฐานที่ ${esc(s.code)}</option>`).join("");
  }

  function initEvidence() {

    $("#evidence-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target;
      const btn = $("button[type=submit]", form);
      const f = new FormData(form);
      const p = {
        title: f.get("title").trim(), issue: f.get("issue"), phase: f.get("phase"),
        owner: f.get("owner").trim(), url: f.get("url").trim(),
      };
      btn.disabled = true;
      try {
        const item = await run(() => store.addEvidence(p), "บันทึกหลักฐานแล้ว");
        S.evidence.push(item);
        form.reset();
        renderEvidence();
      } catch (err) { /* แจ้งผ่าน toast แล้ว */ } finally {
        btn.disabled = false;
      }
    });

    ["#ev-search", "#ev-filter-std", "#ev-filter-phase"].forEach((s) => $(s).addEventListener("input", renderEvidence));

    $("#evidence-table").addEventListener("click", async (e) => {
      const id = e.target.dataset.del;
      if (!id || !confirm(`ลบหลักฐาน ${id} ?`)) return;
      try {
        await run(() => store.deleteEvidence(id), "ลบแล้ว");
        S.evidence = S.evidence.filter((x) => x.id !== id);
        renderEvidence();
      } catch (err) { /* toast */ }
    });

    $("#ev-export-json").addEventListener("click", () =>
      download(`iqa-evidence-${AY}.json`, JSON.stringify(S.evidence, null, 2), "application/json"));

    $("#ev-export-csv").addEventListener("click", () => {
      const cols = ["id", "title", "issue", "phase", "owner", "url", "createdAt", "createdBy"];
      const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const csv = "﻿" + [cols.join(","), ...S.evidence.map((r) => cols.map((c) => q(r[c])).join(","))].join("\n");
      download(`iqa-evidence-${AY}.csv`, csv, "text/csv;charset=utf-8");
    });

    $("#ev-import").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!Array.isArray(data)) throw new Error("รูปแบบไฟล์ไม่ถูกต้อง");
        const valid = data.filter((x) => x && issueByCode[x.issue]);
        const r = await run(() => store.importEvidence(valid));
        toast(`นำเข้า ${r.added} รายการ (ข้าม ${data.length - r.added} รายการที่ซ้ำหรือไม่ถูกต้อง)`, "ok");
        await reload();
        renderEvidence();
      } catch (err) {
        toast("นำเข้าไม่สำเร็จ: " + err.message, "error");
      }
    });
  }

  function canDelete(e) {
    if (can("evidence:delete:any")) return true;
    return can("evidence:add") && store.user && e.createdBy && e.createdBy === store.user.email;
  }

  function renderEvidence() {
    const q = $("#ev-search").value.trim().toLowerCase();
    const std = $("#ev-filter-std").value;
    const phase = $("#ev-filter-phase").value;
    const all = S.evidence;
    const rows = all.filter((e) =>
      (!std || e.issue.split(".")[0] === std) &&
      (!phase || e.phase === phase) &&
      (!q || [e.id, e.title, e.owner, e.createdBy].join(" ").toLowerCase().includes(q)));

    $("#evidence-table tbody").innerHTML = rows.length ? rows.map((e) => `
      <tr>
        <td class="code">${esc(e.id)}</td>
        <td>${/^https:\/\//i.test(e.url || "") ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title)}
          ${e.createdBy ? `<small class="by">${esc(e.createdBy)}</small>` : ""}</td>
        <td class="code">${esc(e.issue)}</td>
        <td><span class="phase ph-${esc(e.phase)}">${esc(e.phase)}</span></td>
        <td>${esc(e.owner)}</td>
        <td>${canDelete(e) ? `<button class="link danger" data-del="${esc(e.id)}" type="button">ลบ</button>` : ""}</td>
      </tr>`).join("")
      : `<tr><td colspan="6" class="empty">${all.length ? "ไม่พบหลักฐานตามเงื่อนไข" : "ยังไม่มีหลักฐาน"}</td></tr>`;

    $("#coverage").innerHTML = D.standards.map((s) => `
      <div class="panel cov-std"><h3>มาตรฐานที่ ${s.code}</h3>
        ${s.issues.map((i) => {
          const mine = all.filter((e) => e.issue === i.code);
          return `<div class="cov-row" title="${esc(i.name)}"><span class="code">${i.code}</span>
            <span class="cov-phases">${["P", "D", "C", "A"].map((p) => {
              const n = mine.filter((e) => e.phase === p).length;
              return `<span class="cov ${n ? "ph-" + p : ""}">${p}${n ? " " + n : ""}</span>`;
            }).join("")}</span></div>`;
        }).join("")}
      </div>`).join("");
  }

  // ---------- ผลการประเมิน ----------
  function renderAssessment() {
    const editable = can("assess");
    const dis = editable ? "" : "disabled";
    $("#as-readonly").hidden = editable;

    const body = (s, i) => {
      if (i.checklist) {
        return `<ul class="checklist">${i.checklist.map((t, k) => {
          const key = indKey(i, t);
          return `<li><label class="check"><input type="checkbox" data-result="${esc(key)}" ${Number(S.results[key]) === 1 ? "checked" : ""} ${dis}>
            <span><span class="code">${i.code}.${k + 1}</span> ${esc(t.text)}</span></label></li>`;
        }).join("")}</ul>`;
      }
      if (i.rubric) {
        const key = indKey(i, RUBRIC);
        return `<ul class="checklist rubric">${i.rubric.map((t, k) => ({ t, lv: k + 1 })).reverse().map(({ t, lv }) =>
          `<li><label class="check"><input type="radio" name="rb-${i.code}" data-result="${key}" value="${lv}" ${String(S.results[key]) === String(lv) ? "checked" : ""} ${dis}>
            <span>${levelBadge(lv)} ${esc(t)}</span></label></li>`).join("")}</ul>`;
      }
      return i.indicators.map((ind) => {
        const key = indKey(i, ind);
        const v = S.results[key] ?? "";
        const ok = metTarget(ind, v);
        const pct = !has(v) ? 0 : ind.dir === "min" ? Math.min(120, achievement(ind, v)) : Math.min(120, (Number(v) / ind.target) * 100);
        return `<div class="as-ind">
          <span class="as-ind-name">${esc(ind.name)}</span>
          <span class="as-ind-target">เป้าหมาย <b>${fmtTarget(ind)}</b><small>ปี ${PY}: ${ind.prev == null ? "ตัวชี้วัดใหม่" : fmtInd(ind, ind.prev)}</small></span>
          <label class="as-ind-input">ผล <input type="number" step="any" min="0" data-result="${esc(key)}" value="${esc(v)}" ${dis}>${ind.unit && ind.unit !== "%" ? `<small>${esc(ind.unit)}</small>` : ""}</label>
          <span class="bar ${ok === false ? "miss" : ""}" aria-hidden="true"><i class="${ok == null ? "" : ok ? "lv5" : "lv1"}" style="width:${pct / 1.2}%"></i><em></em></span>
          <span class="status ${ok == null ? "" : ok ? "ok" : "miss"}">${ok == null ? "" : ok ? "บรรลุเป้าหมาย" : "ต่ำกว่าเป้าหมาย"}</span>
        </div>`;
      }).join("");
    };

    $("#assessment-list").innerHTML = D.standards.map((s) => {
      const ss = standardScore(s);
      return `
      <div class="panel as-std">
        <div class="as-head"><h2><span class="std-no">มาตรฐานที่ ${s.code}</span> ${esc(s.name)}</h2>
          <div class="as-score"><span class="hint">${esc(ss.label)}</span>${levelBadge(ss.level)}</div></div>
        <p class="criteria as-criteria">${esc(s.criteria || "")}</p>
        ${s.issues.map((i) => {
          const sc = issueScore(i);
          const it = issueTarget(i);
          const n = S.notes[i.code] || {};
          return `<div class="as-issue">
            <div class="as-issue-head"><div><span class="code">${i.code}</span> <strong>${esc(i.name)}</strong>
              ${it != null ? `<small class="hint">เป้าหมายประเด็น ร้อยละ ${fmt(it)}</small>` : ""}</div>
              <div class="as-score"><span class="hint">${esc(sc.label || "")}</span>${levelBadge(issueLevel(i))}</div></div>
            ${body(s, i)}
            <div class="as-verdict">
              <label>ระดับที่คณะกรรมการตัดสิน
                <select data-verdict="${i.code}" ${dis}>
                  <option value="">ตามเกณฑ์ (${sc.level ? sc.level + " " + levelInfo(sc.level).name : "—"})</option>
                  ${D.levels.map((l) => `<option value="${l.level}" ${String(S.verdicts[i.code]) === String(l.level) ? "selected" : ""}>${l.level} ${esc(l.name)}</option>`).join("")}
                </select>
              </label>
              <label>จุดเด่น<textarea rows="2" data-note="${i.code}" data-field="strengths" ${dis}>${esc(n.strengths)}</textarea></label>
              <label>จุดที่ควรพัฒนา<textarea rows="2" data-note="${i.code}" data-field="improve" ${dis}>${esc(n.improve)}</textarea></label>
            </div>
          </div>`;
        }).join("")}
      </div>`;
    }).join("");
  }

  function initAssessment() {
    const list = $("#assessment-list");
    list.addEventListener("change", async (e) => {
      const t = e.target;
      try {
        if (t.dataset.result) {
          const value = t.type === "checkbox" ? (t.checked ? 1 : 0) : t.value === "" ? "" : Number(t.value);
          await run(() => store.setResult(t.dataset.result, value), "บันทึกผลแล้ว");
          S.results[t.dataset.result] = value;
          renderAssessment();
        } else if (t.dataset.verdict) {
          const level = t.value ? Number(t.value) : "";
          await run(() => store.setAssessment(t.dataset.verdict, { level }), "บันทึกระดับแล้ว");
          if (level) S.verdicts[t.dataset.verdict] = level; else delete S.verdicts[t.dataset.verdict];
          renderAssessment();
        }
      } catch (err) { renderAssessment(); }
    });

    // บันทึกจุดเด่น/จุดที่ควรพัฒนา หลังหยุดพิมพ์ 1 วินาที
    const timers = {};
    list.addEventListener("input", (e) => {
      const t = e.target;
      if (!t.dataset.note) return;
      const code = t.dataset.note;
      const field = t.dataset.field;
      S.notes[code] = { ...(S.notes[code] || {}), [field]: t.value };
      const tk = code + field;
      clearTimeout(timers[tk]);
      timers[tk] = setTimeout(() => {
        run(() => store.setAssessment(code, { [field]: S.notes[code][field] }), "บันทึกแล้ว").catch(() => {});
      }, 1000);
    });

    $("#as-clear").addEventListener("click", async () => {
      if (!confirm("ล้างผลการดำเนินงานและระดับที่ตัดสินทั้งหมด?")) return;
      await run(() => store.clearResults(), "ล้างข้อมูลแล้ว").catch(() => {});
      await reload();
      renderAssessment();
    });
  }

  // ---------- รายงาน SAR ----------
  function renderSar() {
    $("#sar").innerHTML = `
      <header class="sar-head">
        <h2>รายงานผลการประเมินตนเองของสถานศึกษา (ร่าง)</h2>
        <p>${esc(D.school.name)}<br>ปีการศึกษา ${AY}</p>
      </header>
      <h3>สรุปผลการประเมินรายมาตรฐาน</h3>
      <div class="table-wrap sar-summary"><table><thead><tr><th>มาตรฐาน</th><th>ค่าเป้าหมาย</th><th>ผลการประเมิน</th><th>ระดับคุณภาพ</th></tr></thead><tbody>
        ${D.standards.map((s) => { const ss = standardScore(s); return `<tr><td>มาตรฐานที่ ${s.code} ${esc(s.name)}</td><td>${esc(s.targetText || "")}</td><td>${esc(ss.label)}</td><td>${levelBadge(ss.level)}</td></tr>`; }).join("")}
      </tbody></table></div>
      ${D.standards.map((s) => `
        <section class="sar-std">
          <h3>มาตรฐานที่ ${s.code} ${esc(s.name)} — ${levelBadge(standardLevel(s))}</h3>
          ${s.issues.map((i) => {
            const n = S.notes[i.code] || {};
            const evs = S.evidence.filter((e) => e.issue === i.code);
            return `<div class="sar-issue">
              <h4>${i.code} ${esc(i.name)} ${levelBadge(issueLevel(i))}</h4>
              <ul>${i.checklist ? i.checklist.map((t) => `<li>${Number(S.results[indKey(i, t)]) === 1 ? "✓" : "–"} ${esc(t.text)}</li>`).join("")
                : i.rubric ? `<li>${has(S.results[indKey(i, RUBRIC)]) ? esc(i.rubric[Number(S.results[indKey(i, RUBRIC)]) - 1]) : "ยังไม่ประเมิน"}</li>`
                : i.indicators.map((ind) => {
                const v = S.results[indKey(i, ind)];
                return `<li>${esc(ind.name)}: ผล ${fmtInd(ind, v)} / เป้าหมาย ${fmtTarget(ind)} <span class="hint">(ปี ${PY}: ${ind.prev == null ? "ตัวชี้วัดใหม่" : fmtInd(ind, ind.prev)})</span></li>`;
              }).join("")}</ul>
              ${n.strengths ? `<p><b>จุดเด่น:</b> ${esc(n.strengths)}</p>` : ""}
              ${n.improve ? `<p><b>จุดที่ควรพัฒนา:</b> ${esc(n.improve)}</p>` : ""}
              <p class="hint">หลักฐานอ้างอิง (${evs.length}): ${evs.map((e) => esc(e.id)).join(", ") || "—"}</p>
            </div>`;
          }).join("")}
        </section>`).join("")}`;
  }

  // ---------- routing ----------
  const RENDER = {
    home: renderHome, school: renderSchool, structure: renderStructure, standards: renderStandards, process: renderProcess,
    evidence: renderEvidence, assessment: renderAssessment, reports: renderSar,
    admin: () => window.IQAAdmin && window.IQAAdmin.render(),
  };

  function route(scroll = true) {
    const name = (location.hash || "#home").slice(1);
    const page = RENDER[name] ? name : "home";
    const locked = (GATED.has(page) || page === "admin") && store.mode === "remote" && !signedIn();
    const denied = !locked && page === "admin" && !can("admin");
    $$(".page").forEach((p) => { p.hidden = p.id !== (locked ? "page-login" : denied ? "page-denied" : "page-" + page); });
    $$(".nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + page));
    if (locked) {
      store.renderButton($("#gsi-page"));
    } else if (!denied) {
      RENDER[page]();
    }
    $("#nav").classList.remove("open");
    $(".nav-toggle").setAttribute("aria-expanded", "false");
    if (scroll) window.scrollTo(0, 0);
  }

  // ---------- ปีการศึกษา ----------
  async function refreshYears() {
    try {
      const y = await store.listYears();
      YEARS = y && y.years && y.years.length ? y : { active: M.SEED_YEAR, years: [{ year: M.SEED_YEAR }] };
      if (!YEARS.active) YEARS.active = YEARS.years[YEARS.years.length - 1].year;
    } catch (e) {
      toast("โหลดรายการปีการศึกษาไม่สำเร็จ: " + e.message, "error");
    }
    renderYearSelect();
    return YEARS;
  }

  function renderYearSelect() {
    const sel = $("#year-select");
    sel.innerHTML = YEARS.years.map((y) => `<option value="${esc(y.year)}" ${y.year === AY ? "selected" : ""}>${esc(y.year)}${y.year === YEARS.active ? " (ปัจจุบัน)" : ""}</option>`).join("");
    $("#year-switch").hidden = YEARS.years.length < 2;
  }

  // ค่าตั้งค่าของปี: ที่บันทึกไว้ หรือค่าตั้งต้นจาก data.js (เฉพาะปีตั้งต้น)
  async function loadYearConfig(year) {
    const stored = await store.getYearConfig(year);
    if (stored) return M.normalizeYear(stored);
    if (String(year) === String(M.SEED_YEAR)) return M.seedYear();
    return null;
  }

  async function showYear(year, { reloadData = true } = {}) {
    let cfg = null;
    try { cfg = await loadYearConfig(year); } catch (e) { toast("โหลดค่าตั้งค่าปี " + year + " ไม่สำเร็จ: " + e.message, "error"); }
    if (!cfg) cfg = M.normalizeYear({ academicYear: String(year), previousYear: String(Number(year) - 1) });
    setModel(cfg);
    store.setYear(AY);
    $$(".ay").forEach((el) => { el.textContent = AY; });
    $$(".py").forEach((el) => { el.textContent = PY; });
    fillEvidenceOptions();
    renderYearSelect();
    if (reloadData) await reload();
  }

  // คำนวณระดับด้วยค่าตั้งค่าและผลชุดอื่นชั่วคราว (ใช้ตอนสร้างปีใหม่จากผลของปีก่อน)
  function scoreWith(cfg, data) {
    const saved = { CFG };
    const savedS = { ...S };
    setModel(cfg);
    Object.assign(S, { results: data.results || {}, verdicts: data.verdicts || {} });
    try {
      const out = { issues: {}, standards: {} };
      D.standards.forEach((s) => {
        s.issues.forEach((i) => { out.issues[i.code] = issueLevel(i); });
        out.standards[s.code] = standardLevel(s);
      });
      return out;
    } finally {
      setModel(saved.CFG);
      Object.assign(S, savedS);
    }
  }

  // ให้หน้าหลังบ้านเรียกใช้
  window.IQAApp = {
    store, esc, toast, run, levelBadge, fmt, scoreWith,
    get cfg() { return CFG; },
    get years() { return YEARS; },
    get year() { return AY; },
    levels: () => D.levels,
    loadYearConfig, refreshYears, showYear,
    rerender: () => route(false),
  };

  // ---------- init ----------
  async function start() {
    $("#school-name").textContent = D.school.name;
    $$(".school-name").forEach((el) => { el.textContent = D.school.name; });
    setModel(M.seedYear());
    fillEvidenceOptions();
    $("#year-select").addEventListener("change", async (e) => {
      await showYear(e.target.value);
      route(false);
    });
    $$(".domain").forEach((el) => { el.textContent = (window.IQA_CONFIG || {}).allowedDomain || ""; });
    $(".nav-toggle").addEventListener("click", (e) => {
      const open = $("#nav").classList.toggle("open");
      e.currentTarget.setAttribute("aria-expanded", String(open));
    });
    $("#print-sar").addEventListener("click", () => window.print());
    initEvidence();
    initAssessment();
    window.addEventListener("hashchange", () => route());

    store.onError = (e) => toast(e.message || String(e), "error");
    if (store.onAuthChange) {
      store.onAuthChange(async (u) => {
        renderAuth();
        applyPermissions();
        if (u) toast(`ยินดีต้อนรับ ${u.name}`, "ok");
        await reload();
        route(false);
      });
    }

    applyPermissions();
    await refreshYears();
    await showYear(YEARS.active, { reloadData: false });
    route();
    try {
      await store.init();
    } catch (e) {
      toast(e.message, "error");
    }
    renderAuth();
    applyPermissions();
    await reload();
    route(false);
  }

  start();
})();
