/*
 * ชั้นจัดเก็บข้อมูล: โหมด remote (Google Sheets ผ่าน Apps Script + Sign in with Google)
 * หรือโหมด local (localStorage ของเบราว์เซอร์ — ใช้เมื่อยังไม่ได้ตั้งค่า config.js)
 */
(function () {
  "use strict";

  const C = window.IQA_CONFIG || {};
  const D = window.IQA_DATA;
  const AY = D.school.academicYear;
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
    const K = {
      evidence: `iqa.${AY}.evidence`, results: `iqa.${AY}.results`,
      verdicts: `iqa.${AY}.verdicts`, notes: `iqa.${AY}.notes`,
    };
    const L = (k, f) => get("localStorage", k, f);
    const W = (k, v) => set("localStorage", k, v);

    function nextId(evidence, issue, phase) {
      const prefix = `${AY}-${issue}-${phase}-`;
      const max = evidence.filter((e) => e.id.startsWith(prefix))
        .reduce((m, e) => Math.max(m, parseInt(e.id.slice(prefix.length), 10) || 0), 0);
      return prefix + String(max + 1).padStart(3, "0");
    }

    return {
      mode: "local",
      user: { name: "โหมดทดลอง", email: "", role: "admin", perms: ROLE_PERMS.admin },
      async init() { return this.user; },
      async load() {
        return {
          evidence: L(K.evidence, []),
          results: L(K.results, {}),
          verdicts: L(K.verdicts, {}),
          notes: L(K.notes, {}),
        };
      },
      async addEvidence(p) {
        const list = L(K.evidence, []);
        const item = { ...p, id: nextId(list, p.issue, p.phase), createdAt: new Date().toISOString(), createdBy: "" };
        W(K.evidence, [...list, item]);
        return item;
      },
      async deleteEvidence(id) {
        W(K.evidence, L(K.evidence, []).filter((x) => x.id !== id));
      },
      async importEvidence(items) {
        const list = L(K.evidence, []);
        const ids = new Set(list.map((x) => x.id));
        const added = items.filter((x) => x && x.id && x.title && x.issue && /^[PDCA]$/.test(x.phase) && !ids.has(x.id));
        W(K.evidence, [...list, ...added]);
        return { added: added.length, skipped: items.length - added.length };
      },
      async setResult(key, value) {
        const r = L(K.results, {});
        r[key] = value;
        W(K.results, r);
      },
      async setAssessment(issue, patch) {
        if ("level" in patch) {
          const v = L(K.verdicts, {});
          if (patch.level) v[issue] = patch.level; else delete v[issue];
          W(K.verdicts, v);
        }
        const n = L(K.notes, {});
        n[issue] = { ...(n[issue] || {}) };
        if ("strengths" in patch) n[issue].strengths = patch.strengths;
        if ("improve" in patch) n[issue].improve = patch.improve;
        W(K.notes, n);
      },
      async clearResults() {
        del("localStorage", K.results);
        del("localStorage", K.verdicts);
      },
      can(perm) { return this.user.perms.includes(perm); },
    };
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

    async function api(action, payload) {
      const idToken = savedToken();
      if (!idToken) {
        store.signOut(false);
        throw Object.assign(new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่"), { code: 401 });
      }
      let res;
      try {
        // ส่งเป็น text/plain เพื่อไม่ให้เบราว์เซอร์ทำ CORS preflight (Apps Script ไม่รองรับ OPTIONS)
        res = await fetch(C.apiUrl, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ idToken, action, payload }),
        });
      } catch (e) {
        throw new Error("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตหรือ apiUrl");
      }
      let body;
      try { body = await res.json(); } catch (e) { throw new Error("เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง (ตรวจการ deploy Apps Script)"); }
      if (!body.ok) {
        if (body.code === 401) store.signOut(false);
        throw Object.assign(new Error(body.error || "เกิดข้อผิดพลาด"), { code: body.code });
      }
      return body.data;
    }

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
      user: null,
      onAuthChange(fn) { listeners.push(fn); },

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

      load: () => api("load"),
      addEvidence: (p) => api("addEvidence", p),
      deleteEvidence: (id) => api("deleteEvidence", { id }),
      importEvidence: (items) => api("importEvidence", { items }),
      setResult: (key, value) => api("setResult", { key, value }),
      setAssessment: (issue, patch) => api("setAssessment", { issue, ...patch }),
      clearResults: () => api("clearResults"),
      can(perm) { return Boolean(store.user && store.user.perms && store.user.perms.includes(perm)); },
    };
    return store;
  }

  window.IQAStore = REMOTE ? remoteStore() : localStore();
  window.IQAStore.roleName = (r) => ROLE_NAME[r] || r;
})();
