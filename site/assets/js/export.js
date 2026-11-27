/*
 * ดาวน์โหลดไฟล์: Excel (ข้อมูลทั้งปี) และ Word (ร่างรายงาน SAR)
 * ไลบรารีโหลดเมื่อกดดาวน์โหลดเท่านั้น:
 *   - assets/vendor/xlsx.mini.min.js  SheetJS CE 0.18.5 (Apache-2.0)
 *   - assets/vendor/docx.iife.js      docx 9.5.1 (MIT)
 */
(function () {
  "use strict";

  const app = () => window.IQAApp;
  const FONT = "TH Sarabun New";
  const pending = {};

  function loadScript(src) {
    if (pending[src]) return pending[src];
    pending[src] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { delete pending[src]; reject(new Error("โหลดตัวสร้างไฟล์ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่")); };
      document.head.appendChild(s);
    });
    return pending[src];
  }

  // ข้อมูลรายงานของปีที่เลือก (ใช้ค่าตั้งค่าและผลที่ส่งมา หรือโหลดจากระบบ)
  async function yearModel(year, given) {
    const cfg = (given && given.cfg) || (await app().loadYearConfig(year));
    if (!cfg) throw new Error(`ยังไม่มีค่าตั้งค่าของปีการศึกษา ${year}`);
    const data = (given && given.data) || (await app().store.load(year));
    return app().reportModel(cfg, data);
  }

  function saveBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  // ------------------------------------------------------------------ Excel
  async function excel(year, given) {
    await loadScript("assets/vendor/xlsx.mini.min.js");
    const m = await yearModel(year, given);
    const X = window.XLSX;
    const wb = X.utils.book_new();
    const add = (name, header, rows, widths) => {
      const ws = X.utils.aoa_to_sheet([header, ...rows]);
      ws["!cols"] = widths.map((w) => ({ wch: w }));
      ws["!autofilter"] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: header.length - 1 } }) };
      X.utils.book_append_sheet(wb, ws, name);
    };

    add("สรุปรายมาตรฐาน",
      ["มาตรฐานที่", "มาตรฐาน", "ค่าเป้าหมาย", "ผลการประเมิน", "ระดับคุณภาพ", `ผลปี ${m.previousYear}`],
      m.standards.map((s) => [s.code, s.name, s.targetText, s.label, s.levelName, s.prevLevelName]),
      [10, 50, 26, 18, 14, 14]);

    const rows = [];
    m.standards.forEach((s) => s.issues.forEach((i) => i.items.forEach((it) => rows.push([
      s.code, i.code, i.name, it.no, it.name, it.dir || "", it.target ?? "", it.unit || "",
      it.result, it.met || it.resultText || "", it.prev ?? "",
      i.label, i.computedLevelName, i.committeeLevelName, i.levelName, i.strengths, i.improve, i.evidence.join(", "),
    ]))));
    add("ตัวชี้วัดและผล",
      ["มาตรฐานที่", "ประเด็น", "ประเด็นพิจารณา", "ข้อ", "ตัวชี้วัด / รายการ", "ทิศทาง", "ค่าเป้าหมาย", "หน่วย", "ผล",
        "เทียบเป้าหมาย", `ผลปี ${m.previousYear}`, "ผลรายประเด็น", "ระดับตามเกณฑ์", "ระดับที่คณะกรรมการตัดสิน", "ระดับคุณภาพ", "จุดเด่น", "จุดที่ควรพัฒนา", "หลักฐานอ้างอิง"],
      rows,
      [9, 8, 40, 6, 55, 11, 11, 9, 9, 14, 11, 16, 14, 14, 13, 40, 40, 30]);

    add("หลักฐาน",
      ["รหัสหลักฐาน", "ชื่อหลักฐาน", "ประเด็น", "ขั้น PDCA", "ผู้รับผิดชอบ", "ลิงก์", "บันทึกเมื่อ", "ผู้บันทึก"],
      m.evidence.map((e) => [e.id, e.title, e.issue, e.phase, e.owner || "", e.url || "", e.createdAt ? new Date(e.createdAt).toLocaleString("th-TH") : "", e.createdBy || ""]),
      [20, 50, 9, 9, 24, 45, 20, 28]);

    add("เป้าหมาย", ["ข้อ", "เป้าหมาย"], m.goals.map((g) => [g.code, g.text]), [6, 110]);

    const goalCode = Object.fromEntries(m.goals.map((g) => [g.id, g.code]));
    add("กลยุทธ์",
      ["กลยุทธ์ที่", "กลยุทธ์", "มาตรฐานที่เชื่อมโยง", "เป้าหมายที่เชื่อมโยง"],
      m.strategies.map((s) => [s.code, s.name, s.standards.join(", "), s.goals.map((id) => goalCode[id]).filter(Boolean).join(", ")]),
      [10, 90, 20, 22]);

    X.writeFile(wb, `IQA-data-${m.year}.xlsx`, { compression: true });
    return { file: `IQA-data-${m.year}.xlsx`, rows: rows.length };
  }

  // ------------------------------------------------------------------ Word
  async function word(year, given) {
    await loadScript("assets/vendor/docx.iife.js");
    const m = await yearModel(year, given);
    const W = window.docx;
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle } = W;

    const run = (text, o = {}) => new TextRun({ text: String(text ?? ""), font: FONT, size: o.size || 32, bold: o.bold, color: o.color });
    const para = (parts, o = {}) => new Paragraph({
      children: (Array.isArray(parts) ? parts : [parts]).map((p) => (typeof p === "string" ? run(p) : p)),
      alignment: o.align, heading: o.heading, spacing: { after: o.after ?? 80, before: o.before ?? 0 }, bullet: o.bullet ? { level: 0 } : undefined,
    });
    const border = { style: BorderStyle.SINGLE, size: 4, color: "999999" };
    const cell = (text, o = {}) => new TableCell({
      children: [para(run(text, { bold: o.bold, size: 30 }), { after: 0, align: o.align })],
      width: { size: o.w, type: WidthType.PERCENTAGE },
      shading: o.head ? { fill: "E8ECF3" } : undefined,
      margins: { top: 40, bottom: 40, left: 80, right: 80 },
      borders: { top: border, bottom: border, left: border, right: border },
    });
    const table = (header, rows, widths) => new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ tableHeader: true, children: header.map((h, k) => cell(h, { bold: true, head: true, w: widths[k] })) }),
        ...rows.map((r) => new TableRow({ children: r.map((v, k) => cell(v, { w: widths[k], align: k > 0 && widths[k] < 20 ? AlignmentType.CENTER : undefined })) })),
      ],
    });

    const body = [
      para(run("รายงานผลการประเมินตนเองของสถานศึกษา (Self-Assessment Report: SAR)", { size: 40, bold: true }), { align: AlignmentType.CENTER, after: 60 }),
      para(run(m.school, { size: 36, bold: true }), { align: AlignmentType.CENTER, after: 60 }),
      para(run(`ปีการศึกษา ${m.year}`, { size: 36 }), { align: AlignmentType.CENTER, after: 360 }),
      para(run("สรุปผลการประเมินรายมาตรฐาน", { size: 36, bold: true }), { heading: HeadingLevel.HEADING_1, after: 120 }),
      table(["มาตรฐาน", "ค่าเป้าหมาย", "ผลการประเมิน", "ระดับคุณภาพ"],
        m.standards.map((s) => [`มาตรฐานที่ ${s.code} ${s.name}`, s.targetText, s.label || "-", s.levelName || "ยังไม่ประเมิน"]),
        [46, 20, 18, 16]),
    ];

    m.standards.forEach((s) => {
      body.push(para(run(`มาตรฐานที่ ${s.code} ${s.name}`, { size: 36, bold: true }), { heading: HeadingLevel.HEADING_1, before: 360, after: 80 }));
      body.push(para([run("ระดับคุณภาพ: ", { bold: true }), run(`${s.levelName || "ยังไม่ประเมิน"}${s.label ? ` (${s.label})` : ""}`), run(`   ค่าเป้าหมาย: ${s.targetText || "-"}`)]));
      s.issues.forEach((i) => {
        body.push(para(run(`${i.code} ${i.name}`, { size: 32, bold: true }), { heading: HeadingLevel.HEADING_2, before: 200, after: 60 }));
        body.push(para([run("ระดับคุณภาพ: ", { bold: true }), run(`${i.levelName || "ยังไม่ประเมิน"}${i.label ? ` (${i.label})` : ""}${i.committeeLevelName ? " — ตัดสินโดยคณะกรรมการ" : ""}`)]));
        if (i.kind === "indicators") {
          body.push(table(["ตัวชี้วัด", "ค่าเป้าหมาย", "ผล", `ผลปี ${m.previousYear}`],
            i.items.map((it) => [`${it.no}. ${it.name}`, it.targetText, it.resultText || "-", it.prevText]),
            [58, 14, 14, 14]));
        } else {
          i.items.forEach((it) => body.push(para(`${it.resultText ? (it.resultText === "ปฏิบัติได้" ? "✓ " : it.resultText.startsWith("ระดับ") ? `${it.resultText}: ` : "– ") : "– "}${it.name}`, { bullet: true, after: 40 })));
        }
        if (i.strengths) body.push(para([run("จุดเด่น: ", { bold: true }), run(i.strengths)], { before: 80 }));
        if (i.improve) body.push(para([run("จุดที่ควรพัฒนา: ", { bold: true }), run(i.improve)]));
        body.push(para(run(`หลักฐานอ้างอิง (${i.evidence.length}): ${i.evidence.join(", ") || "-"}`, { size: 28, color: "555555" })));
      });
    });

    const doc = new Document({
      creator: m.school,
      title: `SAR ปีการศึกษา ${m.year}`,
      styles: { default: { document: { run: { font: FONT, size: 32 } } } },
      sections: [{ properties: { page: { margin: { top: 1440, bottom: 1440, left: 1700, right: 1440 } } }, children: body }],
    });
    const blob = await Packer.toBlob(doc);
    const name = `SAR-${m.year}-draft.docx`;
    saveBlob(blob, name);
    return { file: name };
  }

  window.IQAExport = { excel, word };
})();
