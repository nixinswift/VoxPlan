import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { FileDown, Printer } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { concreteVolumeM3, cubicMetresToYards, formatConcreteVolume, concreteAreaM2 } from "@/lib/concreteQuantities";

type ConcreteCategory = "slab" | "footing" | "wall";

interface ConcreteItem {
  id: string;
  category: ConcreteCategory;
  description: string;
  quantity: number;
  length: number;
  width: number;
  thickness: number;
  height: number;
  area: number;
  unit: "m" | "ft";
  notes: string;
  package: string;
}

const categoryLabels: Record<ConcreteCategory, string> = {
  slab: "Concrete Slabs",
  footing: "Concrete Footings",
  wall: "Concrete Walls",
};

const calcVolume = concreteVolumeM3;
const formatVol = formatConcreteVolume;

interface ProposalExportProps {
  projectName: string;
  items: ConcreteItem[];
  activePackage: string;
  wastePercent: number;
  disabled?: boolean;
}

export const ProposalExport = ({
  projectName,
  items,
  activePackage,
  wastePercent,
  disabled,
}: ProposalExportProps) => {
  const buildProposal = (mode: "pdf" | "print") => {
    const exportItems =
      activePackage === "all"
        ? items
        : items.filter((i) => i.package === activePackage);

    if (exportItems.length === 0) {
      toast({ title: "No items to export", variant: "destructive" });
      return;
    }

    const categories: ConcreteCategory[] = ["slab", "footing", "wall"];
    const toM3 = calcVolume;
    const grandTotal = exportItems.reduce((s, i) => s + toM3(i), 0);
    const orderTotal = grandTotal * (1 + wastePercent / 100);

    const catData = categories.map((cat) => {
      const catItems = exportItems.filter((i) => i.category === cat);
      const vol = catItems.reduce((s, i) => s + toM3(i), 0);
      return { cat, items: catItems, vol, count: catItems.length };
    });

    const packages = Array.from(new Set(exportItems.map((i) => i.package).filter(Boolean))).sort();

    // Color palette
    const colors = ["#F97316", "#3B82F6", "#10B981"];
    const maxVol = Math.max(...catData.map((c) => c.vol), 1);

    const packageLabel =
      activePackage !== "all" ? ` — ${activePackage}` : "";

    const today = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast({ title: "Popup blocked", description: "Allow popups to export proposals.", variant: "destructive" });
      return;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<link rel="icon" type="image/png" href="${window.location.origin}/favicon.png" />
<title>${(projectName || "Project").replace(/[^\w\s-]/g, "")} — Concrete Estimate</title>

<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
  
  * { margin: 0; padding: 0; box-sizing: border-box; }
  
  @page { 
    size: A4; 
    margin: 0.6in 0.7in; 
  }
  
  body { 
    font-family: 'Inter', -apple-system, sans-serif; 
    color: #1a1a2e; 
    background: white;
    font-size: 11px;
    line-height: 1.5;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  
  .letterhead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 12px;
    border-bottom: 1px solid #e2e8f0;
  }

  .letterhead .mark {
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: #1a1a2e;
  }

  .letterhead .mark em {
    font-style: normal;
    color: #F97316;
  }

  .letterhead .doctype {
    font-size: 9px;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: #94a3b8;
    font-weight: 600;
  }

  .cover { 
    padding: 34px 0 28px; 
    border-bottom: 3px solid #F97316;
    margin-bottom: 30px;
  }

  
  .cover h1 { 
    font-size: 28px; 
    font-weight: 800; 
    color: #1a1a2e;
    letter-spacing: -0.5px;
  }
  
  .cover .subtitle { 
    font-size: 14px; 
    color: #64748b; 
    margin-top: 6px;
    font-weight: 400;
  }
  
  .cover .meta {
    display: flex;
    gap: 24px;
    margin-top: 16px;
    font-size: 11px;
    color: #94a3b8;
  }
  
  .cover .meta span { font-weight: 500; color: #475569; }
  
  /* Summary cards */
  .summary-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-bottom: 28px;
  }
  
  .summary-card {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 16px;
    background: #fafbfc;
  }
  
  .summary-card.total {
    background: #1a1a2e;
    color: white;
    border-color: #1a1a2e;
  }
  
  .summary-card .label { 
    font-size: 10px; 
    text-transform: uppercase; 
    letter-spacing: 0.5px;
    color: #94a3b8; 
    font-weight: 600;
    margin-bottom: 6px;
  }
  
  .summary-card.total .label { color: rgba(255,255,255,0.6); }
  
  .summary-card .value { 
    font-size: 22px; 
    font-weight: 700; 
  }
  
  .summary-card .sub { 
    font-size: 10px; 
    color: #94a3b8; 
    margin-top: 2px;
  }
  
  .summary-card.total .sub { color: rgba(255,255,255,0.5); }
  
  /* Charts section */
  .charts-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    margin-bottom: 28px;
    page-break-inside: avoid;
  }
  
  .chart-box {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 20px;
  }
  
  .chart-title {
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 16px;
    color: #334155;
  }
  
  /* Pie chart via CSS */
  .pie-container {
    display: flex;
    align-items: center;
    gap: 24px;
  }
  
  .pie-chart {
    width: 130px;
    height: 130px;
    border-radius: 50%;
    position: relative;
    flex-shrink: 0;
  }
  
  .pie-legend {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  
  .pie-legend-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
  }
  
  .pie-legend-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  
  .pie-legend-value {
    font-weight: 600;
    margin-left: auto;
    padding-left: 12px;
  }
  
  /* Bar chart */
  .bar-chart { display: flex; flex-direction: column; gap: 10px; }
  
  .bar-row { 
    display: flex; 
    align-items: center; 
    gap: 10px; 
  }
  
  .bar-label { 
    width: 80px; 
    font-size: 10px; 
    font-weight: 500;
    color: #64748b; 
    text-align: right;
    flex-shrink: 0;
  }
  
  .bar-track { 
    flex: 1; 
    height: 24px; 
    background: #f1f5f9; 
    border-radius: 6px; 
    overflow: hidden; 
    position: relative;
  }
  
  .bar-fill { 
    height: 100%; 
    border-radius: 6px; 
    display: flex;
    align-items: center;
    padding-left: 8px;
    font-size: 10px;
    font-weight: 600;
    color: white;
    min-width: fit-content;
  }
  
  .bar-value {
    font-size: 10px;
    font-weight: 600;
    width: 60px;
    text-align: right;
    flex-shrink: 0;
    color: #334155;
  }
  
  /* Tables */
  .section { margin-bottom: 24px; page-break-inside: avoid; }
  
  .section-title { 
    font-size: 14px; 
    font-weight: 700; 
    padding-bottom: 8px;
    border-bottom: 2px solid #F97316;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .section-badge {
    font-size: 9px;
    background: #F97316;
    color: white;
    padding: 2px 8px;
    border-radius: 10px;
    font-weight: 600;
  }
  
  table { 
    width: 100%; 
    border-collapse: collapse; 
    font-size: 10px;
  }
  
  th { 
    background: #f8fafc; 
    font-weight: 600; 
    text-align: left; 
    padding: 8px 10px; 
    border-bottom: 2px solid #e2e8f0;
    color: #475569;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  
  td { 
    padding: 7px 10px; 
    border-bottom: 1px solid #f1f5f9; 
  }
  
  tr:nth-child(even) { background: #fafbfc; }
  
  .subtotal-row { 
    background: #f1f5f9 !important; 
    font-weight: 700; 
  }
  
  .subtotal-row td { 
    border-top: 2px solid #e2e8f0;
    border-bottom: 2px solid #e2e8f0;
  }
  
  .text-right { text-align: right; }
  .font-mono { font-family: 'SF Mono', 'Fira Code', monospace; }
  
  /* Package breakdown */
  .package-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
    margin-bottom: 24px;
  }
  
  .package-card {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 14px;
    background: #fafbfc;
  }
  
  .package-name {
    font-weight: 600;
    font-size: 12px;
    margin-bottom: 8px;
    color: #1a1a2e;
  }
  
  .package-stat {
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    color: #64748b;
    padding: 2px 0;
  }
  
  .package-stat span:last-child { font-weight: 600; color: #334155; }
  
  /* Footer */
  .footer {
    margin-top: 40px;
    padding-top: 16px;
    border-top: 1px solid #e2e8f0;
    display: flex;
    justify-content: space-between;
    font-size: 9px;
    color: #94a3b8;
  }
  
  .footer .brand { font-weight: 700; color: #F97316; }
  
  @media print {
    body { font-size: 10px; }
    .no-print { display: none !important; }
    .page-wrap { max-width: none !important; padding: 0 !important; }
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; }
    thead { display: table-header-group; }
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


<div class="page-wrap" style="max-width:800px;margin:0 auto;padding:20px 0;">

  <div class="letterhead">
    <div class="mark">Vox<em>Plan</em></div>
    <div class="doctype">Concrete Estimate Proposal</div>
  </div>

  <!-- Cover -->
  <div class="cover">

    <h1>${projectName || "Project Estimate"}${packageLabel}</h1>
    <div class="subtitle">Concrete Quantity Takeoff & Volume Summary</div>
    <div class="meta">
      <div>Date: <span>${today}</span></div>
      <div>Items: <span>${exportItems.length}</span></div>
      <div>Waste Factor: <span>${wastePercent}%</span></div>
    </div>
  </div>

  <!-- Summary Cards -->
  <div class="summary-grid">
    ${catData
      .map(
        (c, i) => `
    <div class="summary-card">
      <div class="label">${categoryLabels[c.cat]}</div>
      <div class="value">${c.count}</div>
      <div class="sub">${c.vol.toFixed(2)} m³ · ${cubicMetresToYards(c.vol).toFixed(2)} CY</div>
    </div>`
      )
      .join("")}
    <div class="summary-card total">
      <div class="label">Order Total (+${wastePercent}%)</div>
      <div class="value">${orderTotal.toFixed(2)} m³</div>
      <div class="sub">${cubicMetresToYards(orderTotal).toFixed(2)} CY · Net: ${grandTotal.toFixed(2)} m³</div>
    </div>
  </div>

  <!-- Charts -->
  <div class="charts-row">
    <div class="chart-box">
      <div class="chart-title">Volume Distribution</div>
      <div class="pie-container">
        <div class="pie-chart" style="background: conic-gradient(${catData
          .map((c, i) => {
            const startPct = catData.slice(0, i).reduce((s, x) => s + x.vol, 0) / (grandTotal || 1) * 100;
            const endPct = startPct + (c.vol / (grandTotal || 1)) * 100;
            return `${colors[i]} ${startPct}% ${endPct}%`;
          })
          .join(", ")});">
        </div>
        <div class="pie-legend">
          ${catData
            .filter((c) => c.vol > 0)
            .map(
              (c, i) => `
          <div class="pie-legend-item">
            <div class="pie-legend-dot" style="background:${colors[catData.indexOf(c)]}"></div>
            <span>${categoryLabels[c.cat]}</span>
            <span class="pie-legend-value">${(
              (c.vol / (grandTotal || 1)) *
              100
            ).toFixed(0)}%</span>
          </div>`
            )
            .join("")}
        </div>
      </div>
    </div>
    <div class="chart-box">
      <div class="chart-title">Volume by Category (m³)</div>
      <div class="bar-chart">
        ${catData
          .map(
            (c, i) => `
        <div class="bar-row">
          <div class="bar-label">${categoryLabels[c.cat].replace("Concrete ", "")}</div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${Math.max(
              (c.vol / maxVol) * 100,
              c.vol > 0 ? 8 : 0
            )}%;background:${colors[i]};">${c.vol > 0 ? c.vol.toFixed(1) : ""}</div>
          </div>
          <div class="bar-value">${c.vol.toFixed(2)}</div>
        </div>`
          )
          .join("")}
      </div>
    </div>
  </div>

  ${
    packages.length > 1
      ? `
  <!-- Package Breakdown -->
  <div class="section">
    <div class="section-title">Package Breakdown</div>
    <div class="package-grid">
      ${packages
        .map((pkg) => {
          const pkgItems = exportItems.filter((i) => i.package === pkg);
          const pkgVol = pkgItems.reduce((s, i) => s + calcVolume(i), 0);
          return `
      <div class="package-card">
        <div class="package-name">${pkg}</div>
        <div class="package-stat"><span>Items</span><span>${pkgItems.length}</span></div>
        <div class="package-stat"><span>Slabs</span><span>${pkgItems.filter((i) => i.category === "slab").length}</span></div>
        <div class="package-stat"><span>Footings</span><span>${pkgItems.filter((i) => i.category === "footing").length}</span></div>
        <div class="package-stat"><span>Walls</span><span>${pkgItems.filter((i) => i.category === "wall").length}</span></div>
        <div class="package-stat" style="border-top:1px solid #e2e8f0;padding-top:4px;margin-top:4px;"><span>Volume</span><span style="color:#F97316;">${pkgVol.toFixed(2)} m³</span></div>
      </div>`;
        })
        .join("")}
    </div>
  </div>`
      : ""
  }

  <!-- Detail Tables -->
  ${catData
    .filter((c) => c.items.length > 0)
    .map(
      (c, i) => `
  <div class="section">
    <div class="section-title">
      ${categoryLabels[c.cat]}
      <span class="section-badge">${c.count} item${c.count > 1 ? "s" : ""}</span>
    </div>
    <table>
      <thead>
        <tr>
          <th>Description</th>
          ${packages.length > 0 ? "<th>Package</th>" : ""}
          <th class="text-right">Qty</th>
          <th class="text-right">Area (m²)</th>
          <th class="text-right">Length</th>
          <th class="text-right">Width</th>
          <th class="text-right">${c.cat === "wall" ? "Height" : "Thickness"}</th>
          ${c.cat === "wall" ? '<th class="text-right">Thick.</th>' : ""}
          <th class="text-right">Unit</th>
          <th class="text-right">Volume</th>
        </tr>
      </thead>
      <tbody>
        ${c.items
          .map((item) => {
            const vol = calcVolume(item);
            return `
        <tr>
          <td>${item.description || "—"}</td>
          ${packages.length > 0 ? `<td>${item.package || "—"}</td>` : ""}
          <td class="text-right">${item.quantity}</td>
          <td class="text-right font-mono">${item.area > 0 ? concreteAreaM2(item).toFixed(2) : "—"}</td>
          <td class="text-right font-mono">${item.length || "—"}</td>
          <td class="text-right font-mono">${item.width || "—"}</td>
          <td class="text-right font-mono">${c.cat === "wall" ? (item.height || "—") : (item.thickness || "—")}</td>
          ${c.cat === "wall" ? `<td class="text-right font-mono">${item.thickness || "—"}</td>` : ""}
          <td class="text-right">${item.unit}</td>
          <td class="text-right font-mono" style="font-weight:600;">${formatVol(vol, item.unit)}</td>
        </tr>`;
          })
          .join("")}
        <tr class="subtotal-row">
          <td colspan="${c.cat === "wall" ? (packages.length > 0 ? 8 : 7) : (packages.length > 0 ? 7 : 6)}" class="text-right">Subtotal</td>
          <td></td>
          <td class="text-right font-mono">${c.vol.toFixed(2)} m³</td>
        </tr>
      </tbody>
    </table>
  </div>`
    )
    .join("")}

  <!-- Grand Total -->
  <div class="section" style="margin-top:20px;">
    <table>
      <tbody>
        <tr style="background:#f8fafc;">
          <td style="font-weight:700;padding:10px;">Net Total</td>
          <td class="text-right font-mono" style="font-weight:700;padding:10px;">${grandTotal.toFixed(2)} m³</td>
          <td class="text-right font-mono" style="font-weight:600;padding:10px;color:#64748b;">${cubicMetresToYards(grandTotal).toFixed(2)} CY</td>
        </tr>
        <tr style="background:#1a1a2e;color:white;">
          <td style="font-weight:700;padding:12px;border-radius:0 0 0 8px;">Order Total (+${wastePercent}% waste)</td>
          <td class="text-right font-mono" style="font-weight:700;padding:12px;font-size:14px;">${orderTotal.toFixed(2)} m³</td>
          <td class="text-right font-mono" style="font-weight:600;padding:12px;border-radius:0 0 8px 0;color:rgba(255,255,255,0.7);">${cubicMetresToYards(orderTotal).toFixed(2)} CY</td>
        </tr>
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
    ${mode === "pdf" ? "setTimeout(function(){ window.print(); }, 400);" : "setTimeout(function(){ window.print(); }, 600);"}
  };
</script>
</body>
</html>`;

    printWindow.document.write(html);
    printWindow.document.close();
    toast(
      mode === "pdf"
        ? { title: "Proposal ready", description: 'Choose "Save as PDF" as the destination.' }
        : { title: "Print preview opened", description: "Select your printer to print the proposal." }
    );
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        onClick={() => buildProposal("pdf")}
        className="gap-2"
        disabled={disabled || items.length === 0}
      >
        <FileDown className="h-4 w-4" />
        <span className="hidden sm:inline">Export PDF</span>
        <span className="sm:hidden">PDF</span>
      </Button>
      <Button
        onClick={() => buildProposal("print")}
        variant="outline"
        className="gap-2"
        disabled={disabled || items.length === 0}
      >
        <Printer className="h-4 w-4" />
        <span className="hidden sm:inline">Print</span>
      </Button>
    </div>
  );

};
