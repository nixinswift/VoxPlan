import { Button } from "@/components/ui/button";
import { FileDown, Printer } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Task } from "@/types/schedule";
import { parseEquipment } from "@/lib/scheduleEngine";
import type { ProjectFuelSummary } from "@/lib/projectFuel";
import { useProjectHolidays } from "@/hooks/useProjectHolidays";

interface ScheduleProposalExportProps {
  projectId?: string;
  projectName: string;
  projectDescription?: string | null;
  tasks: Task[];
  fuelSummary?: ProjectFuelSummary | null;
  disabled?: boolean;
}

const TRADE_PALETTE = [
  "#F97316",
  "#3B82F6",
  "#10B981",
  "#8B5CF6",
  "#EF4444",
  "#06B6D4",
  "#EAB308",
  "#EC4899",
  "#14B8A6",
  "#6366F1",
];

const prettyTrade = (trade: string) =>
  trade
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

const addDays = (d: Date, days: number) =>
  { const out = new Date(d); out.setDate(out.getDate() + days); return out; };

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const fmtShort = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

const esc = (s: string) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string)
  );

export const ScheduleProposalExport = ({
  projectName,
  projectDescription,
  tasks,
  fuelSummary,
  disabled,
  projectId,
}: ScheduleProposalExportProps) => {
  const { isHoliday } = useProjectHolidays(projectId);
  const buildProposal = (mode: "pdf" | "print") => {
    if (tasks.length === 0) {
      toast({ title: "No tasks to export", variant: "destructive" });
      return;
    }

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast({
        title: "Popup blocked",
        description: "Allow popups to export the schedule proposal.",
        variant: "destructive",
      });
      return;
    }

    const sorted = [...tasks].sort(
      (a, b) => a.startDate.getTime() - b.startDate.getTime()
    );

    const projectStart = sorted[0].startDate;
    const projectEnd = sorted.reduce<Date>((latest, t) => {
      const end = addDays(t.startDate, t.duration);
      return end > latest ? end : latest;
    }, addDays(projectStart, sorted[0].duration));

    const totalSpanDays = Math.max(
      1,
      Math.round((projectEnd.getTime() - projectStart.getTime()) / 86400000)
    );

    // Trade rollup
    const tradeMap = new Map<string, { days: number; count: number; manpower: number }>();
    tasks.forEach((t) => {
      const key = t.trade;
      const cur = tradeMap.get(key) || { days: 0, count: 0, manpower: 0 };
      cur.days += t.duration;
      cur.count += 1;
      cur.manpower = Math.max(cur.manpower, t.manpower);
      tradeMap.set(key, cur);
    });
    const trades = Array.from(tradeMap.entries())
      .map(([trade, v], i) => ({ trade, ...v, color: TRADE_PALETTE[i % TRADE_PALETTE.length] }))
      .sort((a, b) => b.days - a.days);
    const tradeColor = new Map(trades.map((t) => [t.trade, t.color]));
    const maxTradeDays = Math.max(...trades.map((t) => t.days), 1);

    // Peak manpower by day
    let peakManpower = 0;
    let peakDate = projectStart;
    for (let d = 0; d <= totalSpanDays; d++) {
      const day = addDays(projectStart, d);
      if (isHoliday(day)) continue;
      const total = tasks.reduce((sum, t) => {
        const s = t.startDate.getTime();
        const e = addDays(t.startDate, t.duration).getTime();
        return day.getTime() >= s && day.getTime() < e ? sum + t.manpower : sum;
      }, 0);
      if (total > peakManpower) {
        peakManpower = total;
        peakDate = day;
      }
    }

    const equipment = Array.from(
      new Set(
        tasks
          .flatMap((t) => parseEquipment(t.equipment))
          .map((e) => e.trim())
          .filter(Boolean)
      )
    ).sort();

    const totalManDays = tasks.reduce((s, t) => s + t.manpower * t.duration, 0);

    const today = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const ganttRows = sorted
      .map((t) => {
        const offset = Math.round(
          (t.startDate.getTime() - projectStart.getTime()) / 86400000
        );
        const left = (offset / totalSpanDays) * 100;
        const width = Math.max((t.duration / totalSpanDays) * 100, 1.2);
        const end = addDays(t.startDate, t.duration);
        return `
      <div class="g-row">
        <div class="g-name">${esc(t.name)}</div>
        <div class="g-track">
          <div class="g-bar" style="left:${left}%;width:${width}%;background:${
          tradeColor.get(t.trade) || "#F97316"
        };"></div>
        </div>
        <div class="g-dates">${fmtShort(t.startDate)} – ${fmtShort(end)}</div>
      </div>`;
      })
      .join("");

    // Month scale ticks
    const ticks: string[] = [];
    const tickCursor = new Date(projectStart.getFullYear(), projectStart.getMonth(), 1);
    while (tickCursor <= projectEnd) {
      const offset = (tickCursor.getTime() - projectStart.getTime()) / 86400000;
      if (offset >= 0) {
        ticks.push(
          `<div class="g-tick" style="left:${(offset / totalSpanDays) * 100}%">${tickCursor.toLocaleDateString(
            "en-US",
            { month: "short" }
          )}</div>`
        );
      }
      tickCursor.setMonth(tickCursor.getMonth() + 1);
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<link rel="icon" type="image/png" href="${window.location.origin}/favicon.png" />
<title>${esc((projectName || "Project").replace(/[^\w\s-]/g, ""))} — Construction Schedule</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @page { size: A4 landscape; margin: 0.5in 0.6in; }
  body {
    font-family: 'Inter', -apple-system, sans-serif;
    color: #1a1a2e; background: white; font-size: 11px; line-height: 1.5;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .letterhead { display:flex; align-items:center; justify-content:space-between; padding-bottom:12px; border-bottom:1px solid #e2e8f0; }
  .letterhead .mark { font-size:13px; font-weight:800; letter-spacing:2px; text-transform:uppercase; }
  .letterhead .mark em { font-style:normal; color:#F97316; }
  .letterhead .doctype { font-size:9px; letter-spacing:1.2px; text-transform:uppercase; color:#94a3b8; font-weight:600; }
  .cover { padding:30px 0 24px; border-bottom:3px solid #F97316; margin-bottom:26px; }
  .cover h1 { font-size:28px; font-weight:800; letter-spacing:-0.5px; }
  .cover .subtitle { font-size:14px; color:#64748b; margin-top:6px; }
  .cover .meta { display:flex; gap:24px; margin-top:16px; font-size:11px; color:#94a3b8; }
  .cover .meta span { font-weight:500; color:#475569; }
  .summary-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:26px; }
  .summary-card { border:1px solid #e2e8f0; border-radius:10px; padding:16px; background:#fafbfc; }
  .summary-card.total { background:#1a1a2e; color:white; border-color:#1a1a2e; }
  .summary-card .label { font-size:10px; text-transform:uppercase; letter-spacing:0.5px; color:#94a3b8; font-weight:600; margin-bottom:6px; }
  .summary-card.total .label { color:rgba(255,255,255,0.6); }
  .summary-card .value { font-size:22px; font-weight:700; }
  .summary-card .sub { font-size:10px; color:#94a3b8; margin-top:2px; }
  .summary-card.total .sub { color:rgba(255,255,255,0.5); }
  .section { margin-bottom:24px; page-break-inside:avoid; }
  .section-title { font-size:14px; font-weight:700; padding-bottom:8px; border-bottom:2px solid #F97316; margin-bottom:12px; display:flex; align-items:center; gap:8px; }
  .section-badge { font-size:9px; background:#F97316; color:white; padding:2px 8px; border-radius:10px; font-weight:600; }
  /* Gantt */
  .g-scale { position:relative; height:16px; margin-left:190px; margin-right:110px; border-bottom:1px solid #e2e8f0; margin-bottom:8px; }
  .g-tick { position:absolute; top:0; font-size:8px; color:#94a3b8; transform:translateX(-2px); border-left:1px solid #e2e8f0; padding-left:3px; height:16px; }
  .g-row { display:flex; align-items:center; gap:0; padding:3px 0; page-break-inside:avoid; }
  .g-name { width:190px; padding-right:10px; font-size:9.5px; font-weight:500; color:#334155; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .g-track { flex:1; position:relative; height:14px; background:#f1f5f9; border-radius:4px; }
  .g-bar { position:absolute; top:0; height:14px; border-radius:4px; }
  .g-dates { width:110px; text-align:right; font-size:8.5px; color:#64748b; font-family:'SF Mono',monospace; }
  /* Bars */
  .bar-chart { display:flex; flex-direction:column; gap:8px; }
  .bar-row { display:flex; align-items:center; gap:10px; }
  .bar-label { width:150px; font-size:10px; font-weight:500; color:#64748b; text-align:right; flex-shrink:0; }
  .bar-track { flex:1; height:20px; background:#f1f5f9; border-radius:5px; overflow:hidden; }
  .bar-fill { height:100%; border-radius:5px; display:flex; align-items:center; padding-left:8px; font-size:9.5px; font-weight:600; color:white; }
  .bar-value { width:70px; text-align:right; font-size:10px; font-weight:600; color:#334155; flex-shrink:0; }
  table { width:100%; border-collapse:collapse; font-size:10px; }
  th { background:#f8fafc; font-weight:600; text-align:left; padding:8px 10px; border-bottom:2px solid #e2e8f0; color:#475569; font-size:9px; text-transform:uppercase; letter-spacing:0.3px; }
  td { padding:7px 10px; border-bottom:1px solid #f1f5f9; }
  tr:nth-child(even) { background:#fafbfc; }
  .text-right { text-align:right; }
  .font-mono { font-family:'SF Mono','Fira Code',monospace; }
  .dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; }
  .chips { display:flex; flex-wrap:wrap; gap:6px; }
  .chip { border:1px solid #e2e8f0; background:#fafbfc; border-radius:14px; padding:4px 10px; font-size:9.5px; color:#334155; font-weight:500; }
  .footer { margin-top:36px; padding-top:16px; border-top:1px solid #e2e8f0; display:flex; justify-content:space-between; font-size:9px; color:#94a3b8; }
  .footer .brand { font-weight:700; color:#F97316; }
  @media print {
    body { font-size:10px; }
    .no-print { display:none !important; }
    .page-wrap { max-width:none !important; padding:0 !important; }
    table { page-break-inside:auto; }
    tr { page-break-inside:avoid; }
    thead { display:table-header-group; }
  }
</style>
</head>
<body>

<div class="no-print" style="background:#1a1a2e;padding:12px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10;">
  <span style="color:white;font-weight:600;font-size:14px;">${mode === "pdf" ? "Saving as PDF…" : "Print Preview"}</span>
  <button onclick="window.print()" style="background:#F97316;color:white;border:none;padding:8px 20px;border-radius:6px;font-weight:600;cursor:pointer;font-size:12px;">
    ${mode === "pdf" ? "Save as PDF" : "Print"}
  </button>
</div>

<div class="page-wrap" style="max-width:1040px;margin:0 auto;padding:20px 0;">

  <div class="letterhead">
    <div class="mark">Vox<em>Plan</em></div>
    <div class="doctype">Construction Schedule Proposal</div>
  </div>

  <div class="cover">
    <h1>${esc(projectName || "Project Schedule")}</h1>
    <div class="subtitle">${esc(projectDescription || "Sequenced construction schedule, manpower and equipment plan")}</div>
    <div class="meta">
      <div>Date: <span>${today}</span></div>
      <div>Tasks: <span>${tasks.length}</span></div>
      <div>Trades: <span>${trades.length}</span></div>
    </div>
  </div>

  <div class="summary-grid">
    <div class="summary-card">
      <div class="label">Start</div>
      <div class="value" style="font-size:16px;">${fmtDate(projectStart)}</div>
      <div class="sub">Mobilization</div>
    </div>
    <div class="summary-card">
      <div class="label">Substantial Completion</div>
      <div class="value" style="font-size:16px;">${fmtDate(projectEnd)}</div>
      <div class="sub">${totalSpanDays} calendar days</div>
    </div>
    <div class="summary-card">
      <div class="label">Peak Manpower</div>
      <div class="value">${peakManpower}</div>
      <div class="sub">on ${fmtShort(peakDate)}</div>
    </div>
    <div class="summary-card total">
      <div class="label">Total Man-Days</div>
      <div class="value">${totalManDays}</div>
      <div class="sub">${tasks.length} activities</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Schedule Timeline <span class="section-badge">${totalSpanDays} days</span></div>
    <div class="g-scale">${ticks.join("")}</div>
    ${ganttRows}
  </div>

  <div class="section">
    <div class="section-title">Duration by Trade</div>
    <div class="bar-chart">
      ${trades
        .map(
          (t) => `
      <div class="bar-row">
        <div class="bar-label">${esc(prettyTrade(t.trade))}</div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${(t.days / maxTradeDays) * 100}%;background:${t.color};">${t.days}d</div>
        </div>
        <div class="bar-value">${t.count} task${t.count === 1 ? "" : "s"}</div>
      </div>`
        )
        .join("")}
    </div>
  </div>

  <div class="section">
    <div class="section-title">Activity Schedule</div>
    <table>
      <thead>
        <tr>
          <th style="width:26px;">#</th>
          <th>Activity</th>
          <th>Trade</th>
          <th class="text-right">Start</th>
          <th class="text-right">End (exclusive)</th>
          <th class="text-right">Duration</th>
          <th class="text-right">Crew</th>
          <th>Equipment</th>
        </tr>
      </thead>
      <tbody>
        ${sorted
          .map((t, i) => {
            const end = addDays(t.startDate, t.duration);
            return `
        <tr>
          <td class="font-mono">${i + 1}</td>
          <td style="font-weight:600;">${esc(t.name)}</td>
          <td><span class="dot" style="background:${tradeColor.get(t.trade) || "#F97316"}"></span>${esc(prettyTrade(t.trade))}</td>
          <td class="text-right font-mono">${fmtShort(t.startDate)}</td>
          <td class="text-right font-mono">${fmtShort(end)}</td>
          <td class="text-right font-mono">${t.duration}d</td>
          <td class="text-right font-mono">${t.manpower}</td>
          <td style="color:#64748b;">${esc(t.equipment || "—")}</td>
        </tr>`;
          })
          .join("")}
      </tbody>
    </table>
  </div>

  ${
    equipment.length > 0
      ? `<div class="section">
    <div class="section-title">Equipment Requirements <span class="section-badge">${equipment.length}</span></div>
    <div class="chips">${equipment.map((e) => `<div class="chip">${esc(e)}</div>`).join("")}</div>
  </div>`
      : ""
  }

  <div class="section">
    <div class="section-title">Schedule Notes &amp; Assumptions</div>
    <table>
      <tbody>
        <tr><td style="font-weight:600;width:200px;">Working calendar</td><td>Durations are end-exclusive calendar spans. Project holidays are excluded from peak manpower.</td></tr>
        <tr><td style="font-weight:600;">Sequencing</td><td>Dates reflect the saved schedule. Only recorded task dependencies are confirmed; construction templates require review.</td></tr>
        <tr><td style="font-weight:600;">Crew loading</td><td>Peak workforce of ${peakManpower} assumes shared trade pools across concurrent activities.</td></tr>
        <tr><td style="font-weight:600;">Diesel demand</td><td>${fuelSummary?.totalLitres != null
          ? `${fuelSummary.totalLitres.toLocaleString("en-CA", { maximumFractionDigits: 2 })} L${fuelSummary.totalCost == null
            ? " · delivered price unverified" : ` · ${fuelSummary.totalCost.toLocaleString("en-CA", { style: "currency", currency: "CAD" })} at ${fuelSummary.price} CAD/L`}`
          : fuelSummary && !fuelSummary.rows.length ? "No equipment assignments." : "UNVERIFIED · see the saved project fuel plan."}</td></tr>
        <tr><td style="font-weight:600;">Basis</td><td>Schedule is based on the current project scope and is subject to change with design revisions, weather, and site access.</td></tr>
      </tbody>
    </table>
  </div>

  <div class="footer">
    <div>Generated on ${today}</div>
    <div>Powered by <span class="brand">VoxPlan</span></div>
  </div>

</div>
<script>
  window.onload = function () {
    setTimeout(function(){ window.print(); }, ${mode === "pdf" ? 400 : 600});
  };
</script>
</body>
</html>`;

    printWindow.document.write(html);
    printWindow.document.close();
    toast(
      mode === "pdf"
        ? { title: "Schedule proposal ready", description: 'Choose "Save as PDF" as the destination.' }
        : { title: "Print preview opened", description: "Select your printer to print the schedule." }
    );
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        onClick={() => buildProposal("pdf")}
        className="gap-2"
        disabled={disabled || tasks.length === 0}
      >
        <FileDown className="h-4 w-4" />
        <span className="hidden sm:inline">Export PDF</span>
        <span className="sm:hidden">PDF</span>
      </Button>
      <Button
        onClick={() => buildProposal("print")}
        variant="outline"
        className="gap-2"
        disabled={disabled || tasks.length === 0}
      >
        <Printer className="h-4 w-4" />
        <span className="hidden sm:inline">Print</span>
      </Button>
    </div>
  );
};
