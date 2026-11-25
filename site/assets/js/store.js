/*
 * ชั้นจัดเก็บข้อมูล: โหมด remote (Google Sheets ผ่าน Apps Script + Sign in with Google)
 * หรือโหมด local (localStorage ของเบราว์เซอร์ — ใช้เมื่อยังไม่ได้ตั้งค่า config.js)
 *
 * ข้อมูลผลการประเมินแยกตามปีการศึกษา (store.year)
 * ค่าตั้งค่าแต่ละปี (เป้าหมาย กลยุทธ์ มาตรฐาน ตัวชี้วัด ค่าเป้าหมาย) จัดการผ่าน listYears / getYearConfig / saveYearConfig
 */
(function () {
  "use strict";

  const C = window.IQA_CONFIG || {};
  const M = window.IQAModel;
  const REMOTE = Boolean(C.apiUrl && C.googleClientId);
  const ROLE_PERMS = {
    admin: ["read", "evidence:add", "evidence:delete:any", "assess", "admin"],
    evaluator: ["read", "evidence:add", "assess"],
    teacher: ["read", "evidence:add"],
    viewer: ["read"],
  };
  const ROLE_NAME = { admin: "ผู้ดูแลระบบ", evaluator: "กรรมการประเมิน", teacher: "ครู", viewer: "ผู้อ่าน" };

  // ---------- storage helpers (กันกรณีเบราว์เซอร์ปิด storage) ----------
  const mem = {};
  function get(area, key, fallback) {
    try {
      const raw = window[area].getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
      return key in mem ? mem[key] : fallback;
    }
  }
  function set(area, key, value) {
    mem[key] = value;
    try { window[area].setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }
  function del(area, key) {
    delete mem[key];
    try { window[area].removeItem(key); } catch (e) { /* ignore */ }
  }

  // =====================================================================
  // LOCAL
  // =====================================================================
  function localStore() {
    const K = (y) => ({
      evidence: `iqa.${y}.evidence`, results: `iqa.${y}.results`,
      verdicts: `iqa.${y}.verdicts`, notes: `iqa.${y}.notes`,
    });
    const REG = "iqa.years";
    const CFG = (y) => `iqa.cfg.${y}`;
    const L = (k, f) => get("localStorage", k, f);
    const W = (k, v) => set("localStorage", k, v);
    const registry = () => L(REG, null) || { active: M.SEED_YEAR, years: { [M.SEED_YEAR]: { updatedAt: "" } } };

    function nextId(evidence, year, issue, phase) {
      const prefix = `${year}-${issue}-${phase}-`;
      const max = evidence.filter((e) => e.id.startsWith(prefix))
        .reduce((m, e) => Math.max(m, parseInt(e.id.slice(prefix.length), 10) || 0), 0);
      return prefix + String(max + 1).padStart(3, "0");
    }

    const store = {
      mode: "local",
      year: M.SEED_YEAR,
      user: { name: "โหมดทดลอง", email: "", role: "admin", perms: ROLE_PERMS.admin },
      async init() { return this.user; },
      setYear(y) { store.year = String(y); },

      // ---------- ปีการศึกษาและค่าตั้งค่า ----------
      async listYears() {
        const r = registry();
        return { active: r.active, years: Object.keys(r.years).sort().map((y) => ({ year: y, ...r.years[y] })) };
      },
      async getYearConfig(y) {
        return L(CFG(y), null);
      },
      async saveYearConfig(y, cfg) {
        y = String(y);
        W(CFG(y), cfg);
        const r = registry();
        r.years[y] = { updatedAt: new Date().toISOString(), updatedBy: "" };
        if (!r.active) r.active = y;
        W(REG, r);
        return { year: y };
      },
      async setActiveYear(y) {
        const r = registry();
        if (!r.years[y]) throw new Error("ไม่พบปีการศึกษา " + y);
        r.active = String(y);
        W(REG, r);
      },
      async deleteYear(y) {
        const r = registry();
        if (r.active === y) throw new Error("ลบปีการศึกษาที่ใช้งานอยู่ไม่ได้");
        delete r.years[y];
        W(REG, r);
        del("localStorage", CFG(y));
      },

      // ---------- ผลการประเมินของปี store.year (หรือปีที่ระบุ) ----------
      async load(y = store.year) {
        const k = K(y);
        return { evidence: L(k.evidence, []), results: L(k.results, {}), verdicts: L(k.verdicts, {}), notes: L(k.notes, {}) };
      },
      async addEvidence(p) {
        const k = K(store.year);
        const list = L(k.evidence, []);
        const item = { ...p, id: nextId(list, store.year, p.issue, p.phase), createdAt: new Date().toISOString(), createdBy: "" };
        W(k.evidence, [...list, item]);
        return item;
      },
      async deleteEvidence(id) {
        const k = K(store.year);
        W(k.evidence, L(k.evidence, []).filter((x) => x.id !== id));
      },
      async importEvidence(items) {
        const k = K(store.year);
        const list = L(k.evidence, []);
        const ids = new Set(list.map((x) => x.id));
        const added = items.filter((x) => x && x.id && x.title && x.issue && /^[PDCA]$/.test(x.phase) && !ids.has(x.id));
        W(k.evidence, [...list, ...added]);
        return { added: added.length, skipped: items.length - added.length };
      },
      async setResult(key, value) {
        const k = K(store.year);
        const r = L(k.results, {});
        r[key] = value;
        W(k.results, r);
      },
      async setAssessment(issue, patch) {
        const k = K(store.year);
        if ("level" in patch) {
          const v = L(k.verdicts, {});
          if (patch.level) v[issue] = patch.level; else delete v[issue];
          W(k.verdicts, v);
        }
        const n = L(k.notes, {});
        n[issue] = { ...(n[issue] || {}) };
        if ("strengths" in patch) n[issue].strengths = patch.strengths;
        if ("improve" in patch) n[issue].improve = patch.improve;
        W(k.notes, n);
      },
      async clearResults() {
        const k = K(store.year);
        del("localStorage", k.results);
        del("localStorage", k.verdicts);
      },
      can(perm) { return this.user.perms.includes(perm); },
    };
    return store;
  }

  // =====================================================================
  // REMOTE (Google Sheets + Sign in with Google)
  // =====================================================================
  function remoteStore() {
    const TOKEN_KEY = "iqa.idToken";
    let listeners = [];

    function decodeJwt(token) {
      try {
        const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        const json = decodeURIComponent(atob(b64).split("").map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join(""));
        return JSON.parse(json);
      } catch (e) {
        return null;
      }
    }

    function savedToken() {
      const t = get("sessionStorage", TOKEN_KEY, null);
      const p = t && decodeJwt(t);
      return p && p.exp * 1000 > Date.now() + 60000 ? t : null;
    }

    async function call(body) {
      let res;
      try {
        // ส่งเป็น text/plain เพื่อไม่ให้เบราว์เซอร์ทำ CORS preflight (Apps Script ไม่รองรับ OPTIONS)
        res = await fetch(C.apiUrl, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(body),
        });
      } catch (e) {
        throw new Error("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตหรือ apiUrl");
      }
      let out;
      try { out = await res.json(); } catch (e) { throw new Error("เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง (ตรวจการ deploy Apps Script)"); }
      if (!out.ok) {
        if (out.code === 401 && body.idToken) store.signOut(false);
        throw Object.assign(new Error(out.error || "เกิดข้อผิดพลาด"), { code: out.code });
      }
      return out.data;
    }

    async function api(action, payload) {
      const idToken = savedToken();
      if (!idToken) {
        store.signOut(false);
        throw Object.assign(new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่"), { code: 401 });
      }
      return call({ idToken, action, payload });
    }
    // ข้อมูลมาตรฐาน/ค่าเป้าหมายเป็นข้อมูลสาธารณะ อ่านได้โดยไม่ต้องล็อกอิน
    const publicApi = (action, payload) => call({ action, payload });

    function loadGis() {
      if (window.google && google.accounts && google.accounts.id) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://accounts.google.com/gsi/client";
        s.async = true;
        s.onload = resolve;
        s.onerror = () => reject(new Error("โหลดระบบล็อกอินของ Google ไม่สำเร็จ"));
        document.head.appendChild(s);
      });
    }

    const emit = () => listeners.forEach((fn) => fn(store.user));

    const store = {
      mode: "remote",
      year: M.SEED_YEAR,
      user: null,
      onAuthChange(fn) { listeners.push(fn); },
      setYear(y) { store.year = String(y); },

      async init() {
        await loadGis();
        google.accounts.id.initialize({
          client_id: C.googleClientId,
          hd: C.allowedDomain,
          auto_select: true,
          cancel_on_tap_outside: true,
          callback: async (resp) => {
            const p = decodeJwt(resp.credential);
            if (!p || (C.allowedDomain && p.hd !== C.allowedDomain)) {
              store.onError(new Error(`กรุณาใช้บัญชี @${C.allowedDomain}`));
              return;
            }
            set("sessionStorage", TOKEN_KEY, resp.credential);
            try {
              store.user = await api("me");
              emit();
            } catch (e) {
              store.signOut(false);
              store.onError(e);
            }
          },
        });
        if (savedToken()) {
          try { store.user = await api("me"); } catch (e) { store.user = null; }
        }
        if (!store.user) google.accounts.id.prompt();
        return store.user;
      },

      renderButton(el) {
        if (!el || !window.google) return;
        el.innerHTML = "";
        google.accounts.id.renderButton(el, { theme: "outline", size: "medium", text: "signin_with", shape: "pill", locale: "th" });
      },

      signOut(notify = true) {
        del("sessionStorage", TOKEN_KEY);
        const was = store.user;
        store.user = null;
        try { google.accounts.id.disableAutoSelect(); } catch (e) { /* ignore */ }
        if (notify || was) emit();
      },

      onError(e) { console.error(e); },

      listYears: () => publicApi("listYears"),
      getYearConfig: (year) => publicApi("getYearConfig", { year }),
      saveYearConfig: (year, config) => api("saveYearConfig", { year, config }),
      setActiveYear: (year) => api("setActiveYear", { year }),
      deleteYear: (year) => api("deleteYear", { year }),

      load: (year = store.year) => api("load", { year }),
      addEvidence: (p) => api("addEvidence", { ...p, year: store.year }),
      deleteEvidence: (id) => api("deleteEvidence", { id }),
      importEvidence: (items) => api("importEvidence", { items }),
      setResult: (key, value) => api("setResult", { year: store.year, key, value }),
      setAssessment: (issue, patch) => api("setAssessment", { year: store.year, issue, ...patch }),
      clearResults: () => api("clearResults", { year: store.year }),
      can(perm) { return Boolean(store.user && store.user.perms && store.user.perms.includes(perm)); },
    };
    return store;
  }

  window.IQAStore = REMOTE ? remoteStore() : localStore();
  window.IQAStore.roleName = (r) => ROLE_NAME[r] || r;
})();
