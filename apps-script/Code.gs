/**
 * pcshscr-iqa — Backend API บน Google Apps Script + Google Sheets
 *
 * ติดตั้ง: ดู apps-script/README.md
 * Script Properties ที่ต้องตั้ง:
 *   CLIENT_ID       OAuth Client ID ของเว็บไซต์ (xxx.apps.googleusercontent.com)
 *   ALLOWED_DOMAIN  โดเมนบัญชีโรงเรียน เช่น pcccr.ac.th
 *   ACADEMIC_YEAR   ปีการศึกษา เช่น 2569 (ใช้สร้างรหัสหลักฐาน)
 *   DEFAULT_ROLE    บทบาทของบัญชีโรงเรียนที่ไม่มีในชีต Users (teacher | viewer) ค่าเริ่มต้น teacher
 */

var SHEETS = {
  Users: ["email", "name", "role", "unit", "active"],
  Evidence: ["id", "title", "issue", "phase", "owner", "url", "createdAt", "createdBy"],
  Results: ["key", "value", "updatedAt", "updatedBy"],
  Assessments: ["issue", "level", "strengths", "improve", "updatedAt", "updatedBy"],
  Log: ["time", "email", "action", "detail"],
};

var ROLE_PERMS = {
  admin: ["read", "evidence:add", "evidence:delete:any", "assess", "admin"],
  evaluator: ["read", "evidence:add", "assess"],
  teacher: ["read", "evidence:add"],
  viewer: ["read"],
};

var ISSUE_RE = /^\d+(\.\d+){1,2}$/;
var KEY_RE = /^\d+(\.\d+){1,2}#\d+$/;
var PHASES = { P: 1, D: 1, C: 1, A: 1 };

// ---------------------------------------------------------------- HTTP

function doGet() {
  return json_({ ok: true, service: "pcshscr-iqa" });
}

function doPost(e) {
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var user = authenticate_(req.idToken);
    var handler = ACTIONS[req.action];
    if (!handler) throw httpError_(400, "ไม่รู้จักคำสั่ง: " + req.action);
    return json_({ ok: true, data: handler(user, req.payload || {}) });
  } catch (err) {
    return json_({ ok: false, code: err.code || 500, error: err.message || String(err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function httpError_(code, message) {
  var e = new Error(message);
  e.code = code;
  return e;
}

// ---------------------------------------------------------------- Auth

function config_() {
  var p = PropertiesService.getScriptProperties();
  return {
    clientId: p.getProperty("CLIENT_ID"),
    domain: (p.getProperty("ALLOWED_DOMAIN") || "").toLowerCase(),
    year: p.getProperty("ACADEMIC_YEAR") || "2569",
    defaultRole: p.getProperty("DEFAULT_ROLE") || "teacher",
  };
}

/** ตรวจ Google ID token กับ Google แล้วคืนข้อมูลผู้ใช้พร้อมบทบาท */
function authenticate_(idToken) {
  if (!idToken) throw httpError_(401, "กรุณาเข้าสู่ระบบ");
  var cfg = config_();
  if (!cfg.clientId || !cfg.domain) throw httpError_(500, "ยังไม่ได้ตั้งค่า CLIENT_ID / ALLOWED_DOMAIN ใน Script Properties");

  var cache = CacheService.getScriptCache();
  var cacheKey = "tok:" + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken));
  var info = null;
  var cached = cache.get(cacheKey);
  if (cached) {
    info = JSON.parse(cached);
  } else {
    var res = UrlFetchApp.fetch(
      "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken),
      { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw httpError_(401, "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");
    info = JSON.parse(res.getContentText());
  }

  var email = String(info.email || "").toLowerCase();
  if (info.aud !== cfg.clientId) throw httpError_(401, "โทเคนไม่ได้ออกให้เว็บไซต์นี้");
  if (String(info.email_verified) !== "true") throw httpError_(401, "อีเมลยังไม่ได้ยืนยัน");
  if (Number(info.exp) * 1000 < Date.now()) throw httpError_(401, "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");
  if (String(info.hd || "").toLowerCase() !== cfg.domain || !endsWith_(email, "@" + cfg.domain)) {
    throw httpError_(403, "ใช้ได้เฉพาะบัญชี @" + cfg.domain);
  }

  if (!cached) {
    var ttl = Math.min(3600, Math.floor(Number(info.exp) - Date.now() / 1000));
    if (ttl > 30) cache.put(cacheKey, JSON.stringify(info), ttl);
  }

  var row = rows_("Users").filter(function (u) { return String(u.email).toLowerCase() === email; })[0];
  if (row && String(row.active).toLowerCase() === "false") throw httpError_(403, "บัญชีนี้ถูกระงับการใช้งาน");
  var role = row && ROLE_PERMS[row.role] ? row.role : (ROLE_PERMS[cfg.defaultRole] ? cfg.defaultRole : "viewer");

  return {
    email: email,
    name: (row && row.name && String(row.name).toLowerCase() !== email) ? row.name : (info.name || email),
    picture: info.picture || "",
    role: role,
    unit: (row && row.unit) || "",
    perms: ROLE_PERMS[role],
  };
}

function require_(user, perm) {
  if (user.perms.indexOf(perm) < 0) throw httpError_(403, "บทบาท " + user.role + " ไม่มีสิทธิ์ทำรายการนี้");
}

function endsWith_(s, suffix) {
  return s.length >= suffix.length && s.slice(s.length - suffix.length) === suffix;
}

// ---------------------------------------------------------------- Actions

var ACTIONS = {
  me: function (user) {
    return user;
  },

  load: function (user) {
    require_(user, "read");
    var results = {};
    rows_("Results").forEach(function (r) { results[r.key] = r.value === "" ? "" : Number(r.value); });
    var verdicts = {};
    var notes = {};
    rows_("Assessments").forEach(function (a) {
      if (a.level !== "" && a.level != null) verdicts[a.issue] = Number(a.level);
      if (a.strengths || a.improve) notes[a.issue] = { strengths: String(a.strengths || ""), improve: String(a.improve || "") };
    });
    var evidence = rows_("Evidence").map(function (e) {
      return {
        id: String(e.id), title: String(e.title), issue: String(e.issue), phase: String(e.phase),
        owner: String(e.owner || ""), url: String(e.url || ""),
        createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : String(e.createdAt || ""),
        createdBy: String(e.createdBy || ""),
      };
    });
    return { evidence: evidence, results: results, verdicts: verdicts, notes: notes, academicYear: config_().year };
  },

  addEvidence: function (user, p) {
    require_(user, "evidence:add");
    var item = cleanEvidence_(p);
    return withLock_(function () {
      item.id = nextEvidenceId_(item.issue, item.phase);
      item.createdAt = new Date().toISOString();
      item.createdBy = user.email;
      appendRow_("Evidence", item);
      log_(user, "addEvidence", item.id);
      return item;
    });
  },

  deleteEvidence: function (user, p) {
    require_(user, "evidence:add");
    var id = String(p.id || "");
    return withLock_(function () {
      var sh = sheet_("Evidence");
      var data = sh.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]) !== id) continue;
        var owner = String(data[i][7]).toLowerCase();
        if (owner !== user.email && user.perms.indexOf("evidence:delete:any") < 0) {
          throw httpError_(403, "ลบได้เฉพาะหลักฐานที่ตนเองบันทึก");
        }
        sh.deleteRow(i + 1);
        log_(user, "deleteEvidence", id);
        return { id: id };
      }
      throw httpError_(404, "ไม่พบหลักฐาน " + id);
    });
  },

  importEvidence: function (user, p) {
    require_(user, "admin");
    var items = Array.isArray(p.items) ? p.items : [];
    return withLock_(function () {
      var ids = {};
      rows_("Evidence").forEach(function (e) { ids[e.id] = 1; });
      var added = 0;
      items.forEach(function (raw) {
        try {
          var item = cleanEvidence_(raw);
          var id = String(raw.id || "");
          if (!/^\d{4}-\d+(\.\d+){1,2}-[PDCA]-\d{3,}$/.test(id) || ids[id]) return;
          item.id = id;
          item.createdAt = raw.createdAt || new Date().toISOString();
          item.createdBy = user.email;
          appendRow_("Evidence", item);
          ids[id] = 1;
          added++;
        } catch (e) { /* ข้ามรายการที่ไม่ถูกต้อง */ }
      });
      log_(user, "importEvidence", added + " items");
      return { added: added, skipped: items.length - added };
    });
  },

  setResult: function (user, p) {
    require_(user, "assess");
    var key = String(p.key || "");
    if (!KEY_RE.test(key)) throw httpError_(400, "รหัสตัวชี้วัดไม่ถูกต้อง");
    var value = p.value === "" || p.value == null ? "" : Number(p.value);
    if (value !== "" && (!isFinite(value) || value < 0)) throw httpError_(400, "ผลการดำเนินงานต้องเป็นตัวเลขไม่ติดลบ");
    return withLock_(function () {
      upsert_("Results", "key", { key: key, value: value, updatedAt: new Date().toISOString(), updatedBy: user.email });
      log_(user, "setResult", key + "=" + value);
      return { key: key, value: value };
    });
  },

  setAssessment: function (user, p) {
    require_(user, "assess");
    var issue = String(p.issue || "");
    if (!ISSUE_RE.test(issue)) throw httpError_(400, "รหัสประเด็นไม่ถูกต้อง");
    var patch = { issue: issue, updatedAt: new Date().toISOString(), updatedBy: user.email };
    if ("level" in p) {
      var lv = p.level === "" || p.level == null ? "" : Number(p.level);
      if (lv !== "" && [1, 2, 3, 4, 5].indexOf(lv) < 0) throw httpError_(400, "ระดับคุณภาพต้องเป็น 1–5");
      patch.level = lv;
    }
    if ("strengths" in p) patch.strengths = String(p.strengths || "").slice(0, 5000);
    if ("improve" in p) patch.improve = String(p.improve || "").slice(0, 5000);
    return withLock_(function () {
      upsert_("Assessments", "issue", patch);
      log_(user, "setAssessment", issue);
      return patch;
    });
  },

  clearResults: function (user) {
    require_(user, "admin");
    return withLock_(function () {
      clearData_("Results");
      var sh = sheet_("Assessments");
      var data = sh.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) sh.getRange(i + 1, 2).setValue("");
      log_(user, "clearResults", "");
      return { cleared: true };
    });
  },
};

// ---------------------------------------------------------------- Validation & IDs

function cleanEvidence_(p) {
  var title = String(p.title || "").trim().slice(0, 300);
  var issue = String(p.issue || "");
  var phase = String(p.phase || "");
  var url = String(p.url || "").trim().slice(0, 1000);
  if (!title) throw httpError_(400, "กรุณาระบุชื่อหลักฐาน");
  if (!ISSUE_RE.test(issue)) throw httpError_(400, "รหัสประเด็นไม่ถูกต้อง");
  if (!PHASES[phase]) throw httpError_(400, "ขั้น PDCA ไม่ถูกต้อง");
  if (url && !/^https:\/\//i.test(url)) throw httpError_(400, "ลิงก์ต้องขึ้นต้นด้วย https://");
  return { title: title, issue: issue, phase: phase, owner: String(p.owner || "").trim().slice(0, 200), url: url };
}

function nextEvidenceId_(issue, phase) {
  var prefix = config_().year + "-" + issue + "-" + phase + "-";
  var max = 0;
  rows_("Evidence").forEach(function (e) {
    var id = String(e.id);
    if (id.indexOf(prefix) === 0) max = Math.max(max, parseInt(id.slice(prefix.length), 10) || 0);
  });
  return prefix + ("00" + (max + 1)).slice(-Math.max(3, String(max + 1).length));
}

// ---------------------------------------------------------------- Sheet helpers

function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(SHEETS[name]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function rows_(name) {
  var values = sheet_(name).getDataRange().getValues();
  var head = values.shift() || [];
  return values.map(function (r) {
    var o = {};
    head.forEach(function (h, i) { o[h] = r[i]; });
    return o;
  });
}

/** กันสูตรถูกฉีดเข้าชีต: ข้อความที่ขึ้นต้นด้วย = + - @ จะถูกบันทึกเป็นข้อความ */
function safe_(v) {
  if (typeof v === "string" && /^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

function appendRow_(name, obj) {
  sheet_(name).appendRow(SHEETS[name].map(function (h) { return safe_(obj[h] == null ? "" : obj[h]); }));
}

function upsert_(name, keyField, patch) {
  var sh = sheet_(name);
  var head = SHEETS[name];
  var keyCol = head.indexOf(keyField);
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][keyCol]) === String(patch[keyField])) {
      var row = data[i].slice();
      head.forEach(function (h, c) { if (h in patch) row[c] = safe_(patch[h]); });
      sh.getRange(i + 1, 1, 1, head.length).setValues([row]);
      return;
    }
  }
  appendRow_(name, patch);
}

function clearData_(name) {
  var sh = sheet_(name);
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw httpError_(503, "ระบบไม่ว่าง กรุณาลองใหม่");
  try { return fn(); } finally { lock.releaseLock(); }
}

function log_(user, action, detail) {
  appendRow_("Log", { time: new Date().toISOString(), email: user.email, action: action, detail: detail });
}

// ---------------------------------------------------------------- Setup (รันครั้งเดียวจากตัวแก้ไข Apps Script)

/** สร้างชีตทั้งหมด และเพิ่มผู้ที่รันฟังก์ชันนี้เป็น admin */
function setup() {
  Object.keys(SHEETS).forEach(sheet_);
  var me = Session.getActiveUser().getEmail().toLowerCase();
  if (me && !rows_("Users").some(function (u) { return String(u.email).toLowerCase() === me; })) {
    appendRow_("Users", { email: me, name: me, role: "admin", unit: "งานประกันคุณภาพ", active: true });
  }
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty("ACADEMIC_YEAR")) p.setProperty("ACADEMIC_YEAR", "2569");
  if (!p.getProperty("DEFAULT_ROLE")) p.setProperty("DEFAULT_ROLE", "teacher");
  Logger.log("ตั้งค่าชีตเรียบร้อย ผู้ดูแลระบบ: " + me);
}
