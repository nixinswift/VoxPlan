import { Button } from "@/components/ui/button";
import { FileDown, Printer } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export interface CostLabourLine {
  trade: string;
  tasks: number;
  workerDays: number;
  hours: number;
  rate: number;
  cost: number;
}

export interface CostEquipmentLine {
  key: string;
  tasks: number;
  days: number;
  hours: number;
  rate: number;
  unit: "hr" | "day";
  cost: number;
}

export interface CostMaterialLine {
  group: string;
  description: string;
  qty: number;
  uom: string;
  unitCost: number;
  cost: number;
}

interface Props {
  projectName: string;
  activePackage: string;
  hoursPerDay: number;
  overheadPct: number;
  profitPct: number;
  wastePercent: number;
  labourLines: CostLabourLine[];
  equipmentLines: CostEquipmentLine[];
  materialLines: CostMaterialLine[];
  disabled?: boolean;
  drawingBasis?: boolean;
  proposalNotes?: string[];
}

const humanize = (s: string) =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();

const money = (n: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    isFinite(n) ? n : 0
  );

const money2 = (n: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2 }).format(
    isFinite(n) ? n : 0
  );

const num = (n: number, d = 0) =>
  (isFinite(n) ? n : 0).toLocaleString("en-CA", { minimumFractionDigits: d, maximumFractionDigits: d });

const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const CostProposalExport = ({
  projectName,
  activePackage,
  hoursPerDay,
  overheadPct,
  profitPct,
  wastePercent,
  labourLines,
  equipmentLines,
  materialLines,
  disabled,
  drawingBasis = false,
  proposalNotes = [],
}: Props) => {
  const build = (mode: "pdf" | "print") => {
    if (labourLines.length === 0 && equipmentLines.length === 0 && materialLines.length === 0) {
      toast({ title: "Nothing to export", description: "Add schedule activities or takeoff items first.", variant: "destructive" });
      return;
    }

    const labourTotal = labourLines.reduce((s, l) => s + l.cost, 0);
    const equipTotal = equipmentLines.reduce((s, l) => s + l.cost, 0);
    const materialTotal = materialLines.reduce((s, l) => s + l.cost, 0);
    const directTotal = labourTotal + equipTotal + materialTotal;
    const overhead = directTotal * (overheadPct / 100);
    const profit = (directTotal + overhead) * (profitPct / 100);
    const grandTotal = directTotal + overhead + profit;
    const totalHours = labourLines.reduce((s, l) => s + l.hours, 0);

    const packageLabel = activePackage !== "all" ? ` — ${activePackage}` : "";
    const today = new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });

    const cats = [
      { name: "Labour", value: labourTotal, color: "#F97316" },
      { name: "Equipment", value: equipTotal, color: "#3B82F6" },
      { name: "Materials", value: materialTotal, color: "#10B981" },
    ];
    const maxVal = Math.max(...cats.map((c) => c.value), 1);

    const w = window.open("", "_blank");
    if (!w) {
      toast({ title: "Popup blocked", description: "Allow popups to export the cost proposal.", variant: "destructive" });
      return;
    }

    const materialGroups = Array.from(new Set(materialLines.map((m) => m.group))).sort();

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<link rel="icon" type="image/png" href="${window.location.origin}/favicon.png" />
<title>${esc((projectName || "Project").replace(/[^\w\s-]/g, ""))} — Cost Estimate</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  @page { size: A4; margin: 0.6in 0.7in; }
  body { font-family:'Inter',-apple-system,sans-serif; color:#1a1a2e; background:white; font-size:11px; line-height:1.5; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .letterhead { display:flex; align-items:center; justify-content:space-between; padding-bottom:12px; border-bottom:1px solid #e2e8f0; }
  .letterhead .mark { font-size:13px; font-weight:800; letter-spacing:2px; text-transform:uppercase; }
  .letterhead .mark em { font-style:normal; color:#F97316; }
  .letterhead .doctype { font-size:9px; letter-spacing:1.2px; text-transform:uppercase; color:#94a3b8; font-weight:600; }
  .cover { padding:34px 0 28px; border-bottom:3px solid #F97316; margin-bottom:30px; }
  .cover h1 { font-size:28px; font-weight:800; letter-spacing:-0.5px; }
  .cover .subtitle { font-size:14px; color:#64748b; margin-top:6px; }
  .cover .meta { display:flex; gap:24px; margin-top:16px; font-size:11px; color:#94a3b8; flex-wrap:wrap; }
  .cover .meta span { font-weight:500; color:#475569; }
  .summary-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:28px; }
  .summary-card { border:1px solid #e2e8f0; border-radius:10px; padding:16px; background:#fafbfc; }
  .summary-card.total { background:#1a1a2e; color:white; border-color:#1a1a2e; }
  .summary-card .label { font-size:10px; text-transform:uppercase; letter-spacing:0.5px; color:#94a3b8; font-weight:600; margin-bottom:6px; }
  .summary-card.total .label { color:rgba(255,255,255,0.6); }
  .summary-card .value { font-size:20px; font-weight:700; }
  .summary-card .sub { font-size:10px; color:#94a3b8; margin-top:2px; }
  .summary-card.total .sub { color:rgba(255,255,255,0.5); }
  .charts-row { display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:28px; page-break-inside:avoid; }
  .chart-box { border:1px solid #e2e8f0; border-radius:10px; padding:20px; }
  .chart-title { font-size:12px; font-weight:600; margin-bottom:16px; color:#334155; }
  .pie-container { display:flex; align-items:center; gap:24px; }
  .pie-chart { width:130px; height:130px; border-radius:50%; flex-shrink:0; }
  .pie-legend { display:flex; flex-direction:column; gap:8px; width:100%; }
  .pie-legend-item { display:flex; align-items:center; gap:8px; font-size:11px; }
  .pie-legend-dot { width:10px; height:10px; border-radius:50%; flex-shrink:0; }
  .pie-legend-value { font-weight:600; margin-left:auto; padding-left:12px; }
  .bar-chart { display:flex; flex-direction:column; gap:10px; }
  .bar-row { display:flex; align-items:center; gap:10px; }
  .bar-label { width:70px; font-size:10px; font-weight:500; color:#64748b; text-align:right; flex-shrink:0; }
  .bar-track { flex:1; height:24px; background:#f1f5f9; border-radius:6px; overflow:hidden; }
  .bar-fill { height:100%; border-radius:6px; }
  .bar-value { font-size:10px; font-weight:600; width:78px; text-align:right; flex-shrink:0; color:#334155; }
  .section { margin-bottom:24px; page-break-inside:avoid; }
  .section-title { font-size:14px; font-weight:700; padding-bottom:8px; border-bottom:2px solid #F97316; margin-bottom:10px; display:flex; align-items:center; gap:8px; }
  .section-badge { font-size:9px; background:#F97316; color:white; padding:2px 8px; border-radius:10px; font-weight:600; }
  table { width:100%; border-collapse:collapse; font-size:10px; }
  th { background:#f8fafc; font-weight:600; text-align:left; padding:8px 10px; border-bottom:2px solid #e2e8f0; color:#475569; font-size:9px; text-transform:uppercase; letter-spacing:0.3px; }
  td { padding:7px 10px; border-bottom:1px solid #f1f5f9; }
  tr:nth-child(even) { background:#fafbfc; }
  .subtotal-row { background:#f1f5f9 !important; font-weight:700; }
  .subtotal-row td { border-top:2px solid #e2e8f0; border-bottom:2px solid #e2e8f0; }
  .group-row td { background:#eef2f7 !important; font-weight:600; font-size:10px; }
  .text-right { text-align:right; }
  .font-mono { font-family:'SF Mono','Fira Code',monospace; }
  .notes { border:1px solid #e2e8f0; border-radius:10px; padding:16px; background:#fafbfc; font-size:10px; color:#475569; }
  .notes ul { margin:6px 0 0 16px; }
  .notes li { margin-bottom:3px; }
  .footer { margin-top:40px; padding-top:16px; border-top:1px solid #e2e8f0; display:flex; justify-content:space-between; font-size:9px; color:#94a3b8; }
  .footer .brand { font-weight:700; color:#F97316; }
  @media print { body { font-size:10px; } .no-print { display:none !important; } .page-wrap { max-width:none !important; padding:0 !important; } table { page-break-inside:auto; } tr { page-break-inside:avoid; } thead { display:table-header-group; } }
</style>
</head>
<body>
<div class="no-print" style="background:#1a1a2e;padding:12px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10;">
  <span style="color:white;font-weight:600;font-size:14px;">${mode === "pdf" ? "Saving as PDF…" : "Print Preview"}</span>
  <button onclick="window.print()" style="background:#F97316;color:white;border:none;padding:8px 20px;border-radius:6px;font-weight:600;cursor:pointer;font-size:12px;">${mode === "pdf" ? "Save as PDF" : "Print"}</button>
</div>

<div class="page-wrap" style="max-width:800px;margin:0 auto;padding:20px 0;">
  <div class="letterhead">
    <div class="mark">Vox<em>Plan</em></div>
    <div class="doctype">Cost Estimate Proposal</div>
  </div>

  <div class="cover">
    <h1>${esc(projectName || "Project Estimate")}${esc(packageLabel)}</h1>
    <div class="subtitle">Detailed Cost Estimate &amp; Bid Summary (CAD)</div>
    <div class="meta">
      <div>Date: <span>${today}</span></div>
      <div>Man-Hours: <span>${num(totalHours)}</span></div>
      <div>Shift: <span>${hoursPerDay} hrs/day</span></div>
      <div>Waste Factor: <span>${wastePercent}%</span></div>
    </div>
  </div>

  <div class="summary-grid">
    ${cats
      .map(
        (c) => `
    <div class="summary-card">
      <div class="label">${c.name}</div>
      <div class="value">${money(c.value)}</div>
      <div class="sub">${directTotal > 0 ? ((c.value / directTotal) * 100).toFixed(0) : 0}% of direct cost</div>
    </div>`
      )
      .join("")}
    <div class="summary-card total">
      <div class="label">Total Bid</div>
      <div class="value">${money(grandTotal)}</div>
      <div class="sub">incl. ${overheadPct}% OH + ${profitPct}% profit</div>
    </div>
  </div>

  <div class="charts-row">
    <div class="chart-box">
      <div class="chart-title">Cost Distribution</div>
      <div class="pie-container">
        <div class="pie-chart" style="background: conic-gradient(${cats
          .map((c, i) => {
            const start = (cats.slice(0, i).reduce((s, x) => s + x.value, 0) / (directTotal || 1)) * 100;
            const end = start + (c.value / (directTotal || 1)) * 100;
            return `${c.color} ${start}% ${end}%`;
          })
          .join(", ")});"></div>
        <div class="pie-legend">
          ${cats
            .filter((c) => c.value > 0)
            .map(
              (c) => `
          <div class="pie-legend-item">
            <div class="pie-legend-dot" style="background:${c.color}"></div>
            <span>${c.name}</span>
            <span class="pie-legend-value">${directTotal > 0 ? ((c.value / directTotal) * 100).toFixed(0) : 0}%</span>
          </div>`
            )
            .join("")}
        </div>
      </div>
    </div>
    <div class="chart-box">
      <div class="chart-title">Direct Cost by Category</div>
      <div class="bar-chart">
        ${cats
          .map(
            (c) => `
        <div class="bar-row">
          <div class="bar-label">${c.name}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.max((c.value / maxVal) * 100, c.value > 0 ? 6 : 0)}%;background:${c.color};"></div></div>
          <div class="bar-value">${money(c.value)}</div>
        </div>`
          )
          .join("")}
      </div>
    </div>
  </div>

  ${
    labourLines.length
      ? `
  <div class="section">
    <div class="section-title">Labour <span class="section-badge">${labourLines.length} trade${labourLines.length > 1 ? "s" : ""}</span></div>
    <table>
      <thead><tr><th>Trade</th><th class="text-right">Activities</th><th class="text-right">Worker-Days</th><th class="text-right">Man-Hours</th><th class="text-right">Rate ($/hr)</th><th class="text-right">Cost</th></tr></thead>
      <tbody>
        ${labourLines
          .map(
            (l) => `<tr>
          <td>${esc(humanize(l.trade))}</td>
          <td class="text-right">${l.tasks}</td>
          <td class="text-right font-mono">${num(l.workerDays, 1)}</td>
          <td class="text-right font-mono">${num(l.hours)}</td>
          <td class="text-right font-mono">${money2(l.rate)}</td>
          <td class="text-right font-mono" style="font-weight:600;">${money(l.cost)}</td>
        </tr>`
          )
          .join("")}
        <tr class="subtotal-row"><td colspan="3" >Labour Subtotal</td><td class="text-right font-mono">${num(totalHours)} hrs</td><td></td><td class="text-right font-mono">${money(labourTotal)}</td></tr>
      </tbody>
    </table>
  </div>`
      : ""
  }

  ${
    equipmentLines.length
      ? `
  <div class="section">
    <div class="section-title">Equipment <span class="section-badge">${equipmentLines.length} item${equipmentLines.length > 1 ? "s" : ""}</span></div>
    <table>
      <thead><tr><th>Equipment</th><th class="text-right">Activities</th><th class="text-right">Days</th><th class="text-right">Hours</th><th class="text-right">Rate</th><th class="text-right">Basis</th><th class="text-right">Cost</th></tr></thead>
      <tbody>
        ${equipmentLines
          .map(
            (e) => `<tr>
          <td>${esc(humanize(e.key))}</td>
          <td class="text-right">${e.tasks}</td>
          <td class="text-right font-mono">${num(e.days, 1)}</td>
          <td class="text-right font-mono">${num(e.hours)}</td>
          <td class="text-right font-mono">${money2(e.rate)}</td>
          <td class="text-right">${e.unit === "day" ? "per day" : "per hour"}</td>
          <td class="text-right font-mono" style="font-weight:600;">${money(e.cost)}</td>
        </tr>`
          )
          .join("")}
        <tr class="subtotal-row"><td colspan="6">Equipment Subtotal</td><td class="text-right font-mono">${money(equipTotal)}</td></tr>
      </tbody>
    </table>
  </div>`
      : ""
  }

  ${
    materialLines.length
      ? `
  <div class="section">
    <div class="section-title">Materials &amp; Takeoff <span class="section-badge">${materialLines.length} line${materialLines.length > 1 ? "s" : ""}</span></div>
    <table>
      <thead><tr><th>Description</th><th class="text-right">Qty</th><th class="text-right">UOM</th><th class="text-right">Unit Cost</th><th class="text-right">Cost</th></tr></thead>
      <tbody>
        ${materialGroups
          .map((g) => {
            const rows = materialLines.filter((m) => m.group === g);
            const sub = rows.reduce((s, m) => s + m.cost, 0);
            return `
        <tr class="group-row"><td colspan="4">${esc(g)}</td><td class="text-right font-mono">${money(sub)}</td></tr>
        ${rows
          .map(
            (m) => `<tr>
          <td style="padding-left:20px;">${esc(m.description)}</td>
          <td class="text-right font-mono">${num(m.qty, 2)}</td>
          <td class="text-right">${esc(m.uom)}</td>
          <td class="text-right font-mono">${money2(m.unitCost)}</td>
          <td class="text-right font-mono" style="font-weight:600;">${money(m.cost)}</td>
        </tr>`
          )
          .join("")}`;
          })
          .join("")}
        <tr class="subtotal-row"><td colspan="4">Materials Subtotal</td><td class="text-right font-mono">${money(materialTotal)}</td></tr>
      </tbody>
    </table>
  </div>`
      : ""
  }

  <div class="section" style="margin-top:20px;">
    <div class="section-title">Bid Summary</div>
    <table>
      <tbody>
        <tr><td style="font-weight:600;">Labour</td><td class="text-right font-mono">${money(labourTotal)}</td></tr>
        <tr><td style="font-weight:600;">Equipment</td><td class="text-right font-mono">${money(equipTotal)}</td></tr>
        <tr><td style="font-weight:600;">Materials</td><td class="text-right font-mono">${money(materialTotal)}</td></tr>
        <tr class="subtotal-row"><td>Total Direct Cost</td><td class="text-right font-mono">${money(directTotal)}</td></tr>
        <tr><td>Overhead (${overheadPct}%)</td><td class="text-right font-mono">${money(overhead)}</td></tr>
        <tr><td>Profit (${profitPct}%)</td><td class="text-right font-mono">${money(profit)}</td></tr>
        <tr style="background:#1a1a2e;color:white;">
          <td style="font-weight:700;padding:12px;">Total Bid Price (CAD)</td>
          <td class="text-right font-mono" style="font-weight:700;padding:12px;font-size:14px;">${money(grandTotal)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="section notes">
    <div style="font-weight:700;font-size:11px;color:#1a1a2e;">Basis of Estimate &amp; Qualifications</div>
    <ul>
      <li>All amounts in Canadian dollars (CAD), excluding applicable taxes.</li>
      <li>${drawingBasis ? "Labour derived from reviewed drawing takeoff installation productivity and crew assumptions" : "Labour derived from the project schedule manpower loading"} at ${hoursPerDay} working hours per day.</li>
      <li>${drawingBasis ? "Equipment costs based on reviewed rental allowances. Documented comparable quotes include entered fixed extras; no live market-price guarantee." : "Equipment costs based on scheduled activity durations and the rates listed above."}</li>
      ${proposalNotes.map(note => `<li>${esc(note)}</li>`).join("")}
      <li>Concrete quantities include a ${wastePercent}% waste/over-order allowance.</li>
      <li>Overhead and profit applied as noted; profit calculated on direct cost plus overhead.</li>
      <li>Excludes permits, bonding, escalation, winter conditions, and unforeseen site conditions unless stated.</li>
      <li>Estimate valid for 30 days from the date of issue.</li>
    </ul>
  </div>

  <div class="footer">
    <div>Generated on ${today}</div>
    <div>Powered by <span class="brand">VoxPlan</span></div>
  </div>
</div>
<script>
  window.onload = function () { setTimeout(function(){ window.print(); }, ${mode === "pdf" ? 400 : 600}); };
</script>
</body>
</html>`;

    w.document.write(html);
    w.document.close();
    toast(
      mode === "pdf"
        ? { title: "Cost proposal ready", description: 'Choose "Save as PDF" as the destination.' }
        : { title: "Print preview opened", description: "Select your printer to print the estimate." }
    );
  };

  return (
    <>
      <Button size="sm" onClick={() => build("pdf")} className="gap-2" disabled={disabled}>
        <FileDown className="h-4 w-4" />
        <span className="hidden sm:inline">Export PDF</span>
        <span className="sm:hidden">PDF</span>
      </Button>
      <Button size="sm" variant="outline" onClick={() => build("print")} className="gap-2" disabled={disabled}>
        <Printer className="h-4 w-4" />
        <span className="hidden sm:inline">Print</span>
      </Button>
    </>
  );
};
