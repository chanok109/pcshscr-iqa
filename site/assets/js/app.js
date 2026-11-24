(function () {
  "use strict";

  const D = window.IQA_DATA;
  const AY = D.school.academicYear;
  const KEYS = {
    evidence: `iqa.${AY}.evidence`,
    results: `iqa.${AY}.results`,
    verdicts: `iqa.${AY}.verdicts`,
    notes: `iqa.${AY}.notes`,
  };
  const PHASE_NAME = { P: "วางแผน", D: "ดำเนินการ", C: "ประเมิน", A: "ปรับปรุง" };

  // ---------- storage (ทำงานได้แม้เบราว์เซอร์ปิด localStorage) ----------
  const mem = {};
  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
      return key in mem ? mem[key] : fallback;
    }
  }
  function save(key, value) {
    mem[key] = value;
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }
  function remove(key) {
    delete mem[key];
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  // ---------- helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const levelInfo = (n) => D.levels.find((l) => l.level === n);

  const issues = D.standards.flatMap((s) => s.issues.map((i) => ({ ...i, std: s })));
  const issueByCode = Object.fromEntries(issues.map((i) => [i.code, i]));
  const indKey = (issue, idx) => `${issue.code}#${idx}`;

  // ---------- ผลการดำเนินงานและระดับคุณภาพ ----------
  function results() {
    const stored = load(KEYS.results, null);
    if (stored) return stored;
    const sample = {};
    issues.forEach((i) => i.indicators.forEach((ind, idx) => { sample[indKey(i, idx)] = ind.sample; }));
    return sample;
  }

  function suggestLevel(result, target) {
    if (result === "" || result == null || isNaN(result) || !target) return null;
    const ratio = Number(result) / Number(target);
    const hit = D.levels.filter((l) => l.minRatio != null).sort((a, b) => b.minRatio - a.minRatio).find((l) => ratio >= l.minRatio);
    return hit ? hit.level : 1;
  }

  function issueSuggested(issue, res = results()) {
    const lv = issue.indicators.map((ind, idx) => suggestLevel(res[indKey(issue, idx)], ind.target)).filter((x) => x != null);
    if (!lv.length) return null;
    return Math.round(lv.reduce((a, b) => a + b, 0) / lv.length);
  }

  function issueLevel(issue, res = results(), verdicts = load(KEYS.verdicts, {})) {
    const v = verdicts[issue.code];
    return v ? Number(v) : issueSuggested(issue, res);
  }

  function standardLevel(std) {
    const res = results();
    const verdicts = load(KEYS.verdicts, {});
    const lv = std.issues.map((i) => issueLevel(i, res, verdicts)).filter((x) => x != null);
    if (!lv.length) return null;
    return Math.round(lv.reduce((a, b) => a + b, 0) / lv.length);
  }

  function levelBadge(n) {
    if (!n) return `<span class="badge lv0">ยังไม่ประเมิน</span>`;
    return `<span class="badge lv${n}">${n} · ${esc(levelInfo(n).name)}</span>`;
  }

  // ---------- หลักฐาน ----------
  const evidence = () => load(KEYS.evidence, []);

  function nextEvidenceId(issue, phase) {
    const prefix = `${AY}-${issue}-${phase}-`;
    const max = evidence()
      .filter((e) => e.id.startsWith(prefix))
      .reduce((m, e) => Math.max(m, parseInt(e.id.slice(prefix.length), 10) || 0), 0);
    return prefix + String(max + 1).padStart(3, "0");
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

  // ---------- render: หน้าแรก ----------
  function renderHome() {
    const ev = evidence();
    const assessed = issues.filter((i) => issueLevel(i) != null).length;
    const covered = issues.filter((i) => ev.some((e) => e.issue === i.code)).length;
    $("#home-stats").innerHTML = [
      ["มาตรฐาน", D.standards.length],
      ["ประเด็นพิจารณา", issues.length],
      ["หลักฐานในคลัง", ev.length],
      ["ประเด็นที่มีหลักฐาน", `${covered}/${issues.length}`],
      ["ประเด็นที่ประเมินแล้ว", `${assessed}/${issues.length}`],
    ].map(([k, v]) => `<div class="stat"><span>${k}</span><strong>${v}</strong></div>`).join("");

    $("#home-standards").innerHTML = D.standards.map((s) => {
      const lv = standardLevel(s);
      return `<a class="card std-card" href="#assessment">
        <span class="std-no">มาตรฐานที่ ${s.code}</span>
        <h3>${esc(s.name)}</h3>
        <div class="meter" aria-hidden="true">${[1, 2, 3, 4, 5].map((n) => `<i class="${lv && n <= lv ? "on lv" + lv : ""}"></i>`).join("")}</div>
        ${levelBadge(lv)}
        <small>${s.issues.length} ประเด็นพิจารณา</small>
      </a>`;
    }).join("");

    $("#home-steps").innerHTML = D.pdca.map((p) =>
      `<li><span class="phase ph-${p.phase}">${p.phase}</span><span>${esc(p.title)}</span></li>`).join("");
  }

  // ---------- render: โครงสร้าง ----------
  function renderStructure() {
    $("#org-standards").innerHTML = D.standards.map((s) =>
      `<div class="org-node small">คณะทำงานมาตรฐานที่ ${s.code}<small>${esc(s.name)}</small></div>`).join("");
    $("#roles-table tbody").innerHTML = D.roles.map((r) =>
      `<tr><th scope="row">${esc(r.unit)}</th><td>${esc(r.duty)}</td><td>${esc(r.output)}</td></tr>`).join("");
  }

  // ---------- render: มาตรฐาน ----------
  function renderStandards() {
    $("#standards-list").innerHTML = D.standards.map((s) => `
      <details class="panel std" ${s.code === "1" ? "open" : ""}>
        <summary><span class="std-no">มาตรฐานที่ ${s.code}</span> ${esc(s.name)} <small>(${s.issues.length} ประเด็น)</small></summary>
        <div class="table-wrap"><table>
          <thead><tr><th>ประเด็น</th><th>ประเด็นพิจารณา</th><th>ตัวชี้วัด</th><th class="num">ค่าเป้าหมาย*</th></tr></thead>
          <tbody>${s.issues.map((i) => i.indicators.map((ind, idx) => `
            <tr>${idx === 0 ? `<td rowspan="${i.indicators.length}" class="code">${i.code}</td><td rowspan="${i.indicators.length}">${esc(i.name)}</td>` : ""}
            <td>${esc(ind.name)}</td><td class="num">${ind.target}</td></tr>`).join("")).join("")}
          </tbody></table></div>
        <p class="hint">* ค่าเป้าหมายเป็นข้อมูลตัวอย่าง แก้ไขได้ที่ <code>assets/js/data.js</code></p>
      </details>`).join("");

    $("#levels-legend").innerHTML = D.levels.map((l) =>
      `<div class="level-item"><span class="badge lv${l.level}">${l.level} · ${esc(l.name)}</span><p>${esc(l.desc)}</p></div>`).join("");
  }

  // ---------- render: กระบวนการ ----------
  function renderProcess() {
    $("#process-list").innerHTML = D.pdca.map((p) => `
      <div class="panel step">
        <div class="step-head"><span class="step-no">${p.step}</span><span class="phase ph-${p.phase}">${p.phase} · ${PHASE_NAME[p.phase]}</span></div>
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

  // ---------- render: คลังหลักฐาน ----------
  function initEvidenceForm() {
    const sel = $("#evidence-form select[name=issue]");
    sel.innerHTML = D.standards.map((s) =>
      `<optgroup label="มาตรฐานที่ ${s.code} ${esc(s.name)}">${s.issues.map((i) =>
        `<option value="${i.code}">${i.code} ${esc(i.name)}</option>`).join("")}</optgroup>`).join("");
    $("#ev-filter-std").innerHTML += D.standards.map((s) => `<option value="${s.code}">มาตรฐานที่ ${s.code}</option>`).join("");

    $("#evidence-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const item = {
        id: nextEvidenceId(f.get("issue"), f.get("phase")),
        title: f.get("title").trim(),
        issue: f.get("issue"),
        phase: f.get("phase"),
        owner: f.get("owner").trim(),
        url: f.get("url").trim(),
        createdAt: new Date().toISOString(),
      };
      save(KEYS.evidence, [...evidence(), item]);
      e.target.reset();
      renderEvidence();
    });

    ["#ev-search", "#ev-filter-std", "#ev-filter-phase"].forEach((s) => $(s).addEventListener("input", renderEvidence));

    $("#evidence-table").addEventListener("click", (e) => {
      const id = e.target.dataset.del;
      if (!id || !confirm(`ลบหลักฐาน ${id} ?`)) return;
      save(KEYS.evidence, evidence().filter((x) => x.id !== id));
      renderEvidence();
    });

    $("#ev-export-json").addEventListener("click", () =>
      download(`iqa-evidence-${AY}.json`, JSON.stringify(evidence(), null, 2), "application/json"));

    $("#ev-export-csv").addEventListener("click", () => {
      const cols = ["id", "title", "issue", "phase", "owner", "url", "createdAt"];
      const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const csv = "﻿" + [cols.join(","), ...evidence().map((r) => cols.map((c) => q(r[c])).join(","))].join("\n");
      download(`iqa-evidence-${AY}.csv`, csv, "text/csv;charset=utf-8");
    });

    $("#ev-import").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!Array.isArray(data)) throw new Error("รูปแบบไฟล์ไม่ถูกต้อง");
        const valid = data.filter((x) => x && x.id && x.title && issueByCode[x.issue] && PHASE_NAME[x.phase]);
        const existing = evidence();
        const ids = new Set(existing.map((x) => x.id));
        const added = valid.filter((x) => !ids.has(x.id));
        save(KEYS.evidence, [...existing, ...added]);
        alert(`นำเข้า ${added.length} รายการ (ข้าม ${data.length - added.length} รายการที่ซ้ำหรือไม่ถูกต้อง)`);
        renderEvidence();
      } catch (err) {
        alert("นำเข้าไม่สำเร็จ: " + err.message);
      }
      e.target.value = "";
    });
  }

  function renderEvidence() {
    const q = $("#ev-search").value.trim().toLowerCase();
    const std = $("#ev-filter-std").value;
    const phase = $("#ev-filter-phase").value;
    const all = evidence();
    const rows = all.filter((e) =>
      (!std || e.issue.split(".")[0] === std) &&
      (!phase || e.phase === phase) &&
      (!q || [e.id, e.title, e.owner].join(" ").toLowerCase().includes(q)));

    $("#evidence-table tbody").innerHTML = rows.length ? rows.map((e) => `
      <tr>
        <td class="code">${esc(e.id)}</td>
        <td>${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title)}</td>
        <td class="code">${esc(e.issue)}</td>
        <td><span class="phase ph-${esc(e.phase)}">${esc(e.phase)}</span></td>
        <td>${esc(e.owner)}</td>
        <td><button class="link danger" data-del="${esc(e.id)}" type="button">ลบ</button></td>
      </tr>`).join("")
      : `<tr><td colspan="6" class="empty">${all.length ? "ไม่พบหลักฐานตามเงื่อนไข" : "ยังไม่มีหลักฐาน — เริ่มบันทึกจากแบบฟอร์มด้านบน"}</td></tr>`;

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

  // ---------- render: ผลการประเมิน ----------
  function renderAssessment() {
    const res = results();
    const verdicts = load(KEYS.verdicts, {});
    const notes = load(KEYS.notes, {});
    $("#assessment-list").innerHTML = D.standards.map((s) => `
      <div class="panel as-std">
        <div class="as-head"><h2><span class="std-no">มาตรฐานที่ ${s.code}</span> ${esc(s.name)}</h2>
          <div data-std-level="${s.code}">${levelBadge(standardLevel(s))}</div></div>
        ${s.issues.map((i) => {
          const sug = issueSuggested(i, res);
          const n = notes[i.code] || {};
          return `<div class="as-issue">
            <div class="as-issue-head"><span class="code">${i.code}</span> <strong>${esc(i.name)}</strong></div>
            ${i.indicators.map((ind, idx) => {
              const k = indKey(i, idx);
              const v = res[k] ?? "";
              const lv = suggestLevel(v, ind.target);
              const pct = v === "" ? 0 : Math.min(120, (Number(v) / ind.target) * 100);
              return `<div class="as-ind">
                <span class="as-ind-name">${esc(ind.name)}</span>
                <span class="as-ind-target">เป้าหมาย <b>${ind.target}</b></span>
                <label class="as-ind-input">ผล <input type="number" step="any" min="0" data-result="${k}" value="${esc(v)}"></label>
                <span class="bar" aria-hidden="true"><i class="lv${lv || 0}" style="width:${pct / 1.2}%"></i><em></em></span>
                <span data-sug="${k}">${levelBadge(lv)}</span>
              </div>`;
            }).join("")}
            <div class="as-verdict">
              <label>ระดับที่คณะกรรมการตัดสิน
                <select data-verdict="${i.code}">
                  <option value="">ตามที่ระบบเสนอ (${sug ? sug + " " + levelInfo(sug).name : "—"})</option>
                  ${D.levels.map((l) => `<option value="${l.level}" ${String(verdicts[i.code]) === String(l.level) ? "selected" : ""}>${l.level} ${esc(l.name)}</option>`).join("")}
                </select>
              </label>
              <label>จุดเด่น<textarea rows="2" data-note="${i.code}" data-field="strengths">${esc(n.strengths)}</textarea></label>
              <label>จุดที่ควรพัฒนา<textarea rows="2" data-note="${i.code}" data-field="improve">${esc(n.improve)}</textarea></label>
            </div>
          </div>`;
        }).join("")}
      </div>`).join("");
  }

  function initAssessment() {
    const list = $("#assessment-list");
    list.addEventListener("change", (e) => {
      const t = e.target;
      if (t.dataset.result) {
        const res = results();
        res[t.dataset.result] = t.value === "" ? "" : Number(t.value);
        save(KEYS.results, res);
        renderAssessment();
      } else if (t.dataset.verdict) {
        const v = load(KEYS.verdicts, {});
        if (t.value) v[t.dataset.verdict] = Number(t.value); else delete v[t.dataset.verdict];
        save(KEYS.verdicts, v);
        renderAssessment();
      }
    });
    list.addEventListener("input", (e) => {
      const t = e.target;
      if (!t.dataset.note) return;
      const n = load(KEYS.notes, {});
      n[t.dataset.note] = { ...(n[t.dataset.note] || {}), [t.dataset.field]: t.value };
      save(KEYS.notes, n);
    });
    $("#as-reset").addEventListener("click", () => {
      if (!confirm("คืนค่าผลการดำเนินงานเป็นข้อมูลตัวอย่าง และล้างระดับที่คณะกรรมการตัดสิน?")) return;
      remove(KEYS.results); remove(KEYS.verdicts);
      renderAssessment();
    });
    $("#as-clear").addEventListener("click", () => {
      if (!confirm("ล้างผลการดำเนินงานทั้งหมดเพื่อเริ่มกรอกค่าจริง?")) return;
      const empty = {};
      issues.forEach((i) => i.indicators.forEach((_, idx) => { empty[indKey(i, idx)] = ""; }));
      save(KEYS.results, empty); remove(KEYS.verdicts);
      renderAssessment();
    });
  }

  // ---------- render: รายงาน SAR ----------
  function renderSar() {
    const res = results();
    const verdicts = load(KEYS.verdicts, {});
    const notes = load(KEYS.notes, {});
    const ev = evidence();
    $("#sar").innerHTML = `
      <header class="sar-head">
        <h2>รายงานผลการประเมินตนเองของสถานศึกษา (ร่าง)</h2>
        <p>${esc(D.school.name)} · ปีการศึกษา ${AY}</p>
      </header>
      <h3>สรุปผลการประเมินรายมาตรฐาน</h3>
      <table><thead><tr><th>มาตรฐาน</th><th>ระดับคุณภาพ</th></tr></thead><tbody>
        ${D.standards.map((s) => `<tr><td>มาตรฐานที่ ${s.code} ${esc(s.name)}</td><td>${levelBadge(standardLevel(s))}</td></tr>`).join("")}
      </tbody></table>
      ${D.standards.map((s) => `
        <section class="sar-std">
          <h3>มาตรฐานที่ ${s.code} ${esc(s.name)} — ${levelBadge(standardLevel(s))}</h3>
          ${s.issues.map((i) => {
            const n = notes[i.code] || {};
            const evs = ev.filter((e) => e.issue === i.code);
            return `<div class="sar-issue">
              <h4>${i.code} ${esc(i.name)} ${levelBadge(issueLevel(i, res, verdicts))}</h4>
              <ul>${i.indicators.map((ind, idx) => {
                const v = res[indKey(i, idx)];
                return `<li>${esc(ind.name)}: ผล ${v === "" || v == null ? "—" : esc(v)} / เป้าหมาย ${ind.target}</li>`;
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
    home: renderHome, structure: renderStructure, standards: renderStandards, process: renderProcess,
    evidence: renderEvidence, assessment: renderAssessment, reports: renderSar,
  };

  function route() {
    const name = (location.hash || "#home").slice(1);
    const page = RENDER[name] ? name : "home";
    $$(".page").forEach((p) => { p.hidden = p.id !== "page-" + page; });
    $$(".nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + page));
    RENDER[page]();
    $("#nav").classList.remove("open");
    $(".nav-toggle").setAttribute("aria-expanded", "false");
    window.scrollTo(0, 0);
  }

  // ---------- init ----------
  $("#school-name").textContent = D.school.name;
  $$(".school-name").forEach((el) => { el.textContent = D.school.name; });
  $$(".ay").forEach((el) => { el.textContent = AY; });
  $(".nav-toggle").addEventListener("click", (e) => {
    const open = $("#nav").classList.toggle("open");
    e.currentTarget.setAttribute("aria-expanded", String(open));
  });
  $("#print-sar").addEventListener("click", () => window.print());
  initEvidenceForm();
  initAssessment();
  window.addEventListener("hashchange", route);
  route();
})();
