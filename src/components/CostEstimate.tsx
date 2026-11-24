import { useEffect, useMemo, useRef, useState } from "react";
import { parseEquipment } from "@/lib/scheduleEngine";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, HardHat, Truck, Package, Loader2, Download, Info, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { tradeLabels as buildingTradeLabels, type BuildingTrade } from "@/components/BuildingTakeoff";
import { CostProposalExport } from "@/components/CostProposalExport";
import { DrawingCostPlanner } from "@/components/DrawingCostPlanner";
import { concreteVolumeM3, cubicMetresToYards } from "@/lib/concreteQuantities";
import { pricePlan, takeoffFingerprint, type CostPlan } from "@/lib/costPlanning";
import { costExportNumber } from "@/lib/costExportNumbers";


interface Props {
  projectId: string;
  projectName: string;
  activePackage: string;
  wastePercent?: number;
  refreshKey?: number;
}

interface TaskRow {
  id: string;
  name: string;
  trade: string;
  manpower: number;
  duration: number;
  equipment: string | null;
}

interface EstimateRow {
  id: string;
  discipline: string;
  category: string;
  trade: string | null;
  description: string;
  quantity: number;
  length: number;
  width: number;
  thickness: number;
  height: number;
  area: number;
  uom: string | null;
  unit: string;
  unit_qty: number | null;
  unit_cost: number;
  package: string | null;
}

interface RateRow {
  kind: "labour" | "equipment";
  key: string;
  rate: number;
  rate_unit: "hr" | "day";
}

const DEFAULT_LABOUR_RATES: Record<string, number> = {
  labourer: 42,
  general: 45,
  carpenter: 62,
  concrete: 58,
  rebar: 60,
  formwork: 60,
  electrical: 78,
  mechanical: 76,
  plumbing: 74,
  demolition: 48,
  asbestos: 68,
  civil: 55,
  structural: 65,
  finishes: 55,
  roofing: 58,
  siding: 52,
  painting: 48,
  operator: 65,
};

const DEFAULT_EQUIPMENT_RATE = 95;

const humanize = (s: string) =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();

const guessLabourRate = (trade: string) => {
  const t = trade.toLowerCase();
  const hit = Object.keys(DEFAULT_LABOUR_RATES).find((k) => t.includes(k));
  return hit ? DEFAULT_LABOUR_RATES[hit] : 55;
};

const money = (n: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(
    isFinite(n) ? n : 0
  );

const money2 = (n: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2 }).format(
    isFinite(n) ? n : 0
  );

const concreteVolume = concreteVolumeM3;

export const CostEstimate = ({ projectId, projectName, activePackage, wastePercent = 5, refreshKey = 0 }: Props) => {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [estimates, setEstimates] = useState<EstimateRow[]>([]);
  const [labourRates, setLabourRates] = useState<Record<string, number>>({});
  const [equipRates, setEquipRates] = useState<Record<string, { rate: number; unit: "hr" | "day" }>>({});
  const [hoursPerDay, setHoursPerDay] = useState(8);
  const [overheadPct, setOverheadPct] = useState(10);
  const [profitPct, setProfitPct] = useState(10);
  const [costPlan, setCostPlan] = useState<CostPlan | null>(null);
  const loadVersion = useRef(0);

  const load = async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    const [tasksRes, estRes, ratesRes, settingsRes, rotationRes] = await Promise.all([
      supabase.from("tasks").select("id,name,trade,manpower,duration,equipment").eq("project_id", projectId),
      supabase.from("estimates").select("*").eq("project_id", projectId),
      supabase.from("project_cost_rates").select("kind,key,rate,rate_unit").eq("project_id", projectId),
      supabase.from("project_cost_settings").select("*").eq("project_id", projectId).maybeSingle(),
      supabase.from("rotation_settings").select("default_shift_length_hours").eq("project_id", projectId).maybeSingle(),
    ]);

    if (version !== loadVersion.current) return;
    const failure = [tasksRes, estRes, ratesRes, settingsRes, rotationRes].find(result => result.error)?.error;
    if (failure) {
      setLoading(false);
      toast({ title: "Costs could not be refreshed", description: failure.message, variant: "destructive" });
      return;
    }
    setTasks((tasksRes.data as TaskRow[]) || []);
    setEstimates(((estRes.data as any[]) || []) as EstimateRow[]);

    const lab: Record<string, number> = {};
    const eq: Record<string, { rate: number; unit: "hr" | "day" }> = {};
    for (const r of ((ratesRes.data as RateRow[]) || [])) {
      if (r.kind === "labour") lab[r.key] = Number(r.rate);
      else eq[r.key] = { rate: Number(r.rate), unit: (r.rate_unit as "hr" | "day") || "hr" };
    }
    setLabourRates(lab);
    setEquipRates(eq);

    const s = settingsRes.data as any;
    if (s) {
      setHoursPerDay(Number(s.hours_per_day) || 8);
      setOverheadPct(Number(s.overhead_pct));
      setProfitPct(Number(s.profit_pct));
    } else {
      const shift = Number((rotationRes.data as any)?.default_shift_length_hours);
      setHoursPerDay(shift > 0 ? shift : 8);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (projectId) load();
    const channel = supabase.channel(`cost-refresh-${projectId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "estimates", filter: `project_id=eq.${projectId}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `project_id=eq.${projectId}` }, () => load())
      .subscribe();
    return () => { loadVersion.current++; supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, refreshKey]);

  const saveSettings = async (patch: Record<string, number>) => {
    await supabase
      .from("project_cost_settings")
      .upsert({ project_id: projectId, hours_per_day: hoursPerDay, overhead_pct: overheadPct, profit_pct: profitPct, currency: "CAD", ...patch } as any, {
        onConflict: "project_id",
      });
  };

  const saveRate = async (kind: "labour" | "equipment", key: string, rate: number, rate_unit: "hr" | "day" = "hr") => {
    const { error } = await supabase
      .from("project_cost_rates")
      .upsert({ project_id: projectId, kind, key, label: humanize(key), rate, rate_unit } as any, {
        onConflict: "project_id,kind,key",
      });
    if (error) toast({ title: "Couldn't save rate", description: error.message, variant: "destructive" });
  };

  // ---- Labour from schedule manpower ----
  const scheduleLabourLines = useMemo(() => {
    const map = new Map<string, { trade: string; workerDays: number; hours: number; tasks: number }>();
    for (const t of tasks) {
      const trade = t.trade || "general";
      const workerDays = (t.manpower || 0) * (t.duration || 0);
      const cur = map.get(trade) || { trade, workerDays: 0, hours: 0, tasks: 0 };
      cur.workerDays += workerDays;
      cur.hours += workerDays * hoursPerDay;
      cur.tasks += 1;
      map.set(trade, cur);
    }
    return Array.from(map.values())
      .map((l) => {
        const rate = labourRates[l.trade] ?? guessLabourRate(l.trade);
        return { ...l, rate, cost: l.hours * rate };
      })
      .sort((a, b) => b.cost - a.cost);
  }, [tasks, hoursPerDay, labourRates]);

  // ---- Equipment from schedule ----
  const scheduleEquipmentLines = useMemo(() => {
    const map = new Map<string, { key: string; days: number; tasks: number }>();
    for (const t of tasks) {
      const raw = (t.equipment || "").trim();
      if (!raw || /^(none|n\/a|na)$/i.test(raw)) continue;
      for (const piece of parseEquipment(raw)) {
        const name = piece.trim();
        if (!name) continue;
        const key = name.toLowerCase();
        const cur = map.get(key) || { key, days: 0, tasks: 0 };
        cur.days += t.duration || 0;
        cur.tasks += 1;
        map.set(key, cur);
      }
    }
    return Array.from(map.values())
      .map((e) => {
        const cfg = equipRates[e.key] || { rate: DEFAULT_EQUIPMENT_RATE, unit: "hr" as const };
        const cost = cfg.unit === "day" ? e.days * cfg.rate : e.days * hoursPerDay * cfg.rate;
        return { ...e, rate: cfg.rate, unit: cfg.unit, hours: e.days * hoursPerDay, cost };
      })
      .sort((a, b) => b.cost - a.cost);
  }, [tasks, equipRates, hoursPerDay]);

  // ---- Materials from estimate items ----
  const materialLines = useMemo(() => {
    const filtered = activePackage === "all" ? estimates : estimates.filter((e) => (e.package || "") === activePackage);
    return filtered
      .map((e) => {
        if (e.discipline === "building") {
          const qty = Number(e.unit_qty) || 0;
          return {
            id: e.id,
            group: buildingTradeLabels[(e.trade || "other") as BuildingTrade] || humanize(e.trade || "Other"),
            description: e.description || "(no description)",
            qty,
            uom: (e.uom || "ea").toUpperCase(),
            unitCost: Number(e.unit_cost) || 0,
            cost: qty * (Number(e.unit_cost) || 0),
          };
        }
        const vol = concreteVolume(e);
        const qty = (e.unit === "ft" ? cubicMetresToYards(vol) : vol) * (1 + wastePercent / 100);
        return {
          id: e.id,
          group: humanize(e.category || "concrete"),
          description: e.description || "(no description)",
          qty,
          uom: e.unit === "ft" ? "CY" : "M³",
          unitCost: Number(e.unit_cost) || 0,
          cost: qty * (Number(e.unit_cost) || 0),
        };
      })
      .filter((l) => l.qty > 0 || l.unitCost > 0);
  }, [estimates, activePackage, wastePercent]);

  const planningTakeoff = useMemo(() => estimates
    .filter(e => activePackage === "all" || e.package === activePackage)
    .map(e => ({ id: e.id, description: e.description, trade: e.discipline === "building" ? e.trade || "other" : "concrete",
      qty: e.discipline === "building" ? Number(e.unit_qty) || 0 : e.unit === "ft" ? cubicMetresToYards(concreteVolume(e)) : concreteVolume(e),
      uom: e.discipline === "building" ? e.uom || "ea" : e.unit === "ft" ? "CY" : "m3" })), [estimates, activePackage]);
  const proposalPrices = costPlan ? pricePlan(costPlan, hoursPerDay, new Date().toISOString().slice(0, 10)) : null;
  const proposalStale = Boolean(costPlan && costPlan.fingerprint !== takeoffFingerprint(planningTakeoff));
  const proposalIncomplete = Boolean(costPlan && proposalPrices && !proposalPrices.complete);
  const useProposal = Boolean(costPlan?.useInBid && proposalPrices?.complete && !proposalStale);
  // A proposal the user approved but that no longer qualifies must be loudly
  // excluded — never silently swapped back to schedule allowances.
  const proposalExcluded = Boolean(costPlan?.useInBid && !useProposal);
  const labourLines = useProposal && proposalPrices ? proposalPrices.labour : scheduleLabourLines;
  const equipmentLines = useProposal && proposalPrices ? proposalPrices.equipment : scheduleEquipmentLines;

  const setUnitCost = async (id: string, unitCost: number) => {
    setEstimates((prev) => prev.map((e) => (e.id === id ? { ...e, unit_cost: unitCost } : e)));
    const { error } = await supabase.from("estimates").update({ unit_cost: unitCost } as any).eq("id", id);
    if (error) toast({ title: "Couldn't save unit cost", description: error.message, variant: "destructive" });
  };

  const labourTotal = labourLines.reduce((s, l) => s + l.cost, 0);
  const equipTotal = equipmentLines.reduce((s, l) => s + l.cost, 0);
  const materialTotal = materialLines.reduce((s, l) => s + l.cost, 0);
  const directTotal = labourTotal + equipTotal + materialTotal;
  const overhead = directTotal * (overheadPct / 100);
  const profit = (directTotal + overhead) * (profitPct / 100);
  const grandTotal = directTotal + overhead + profit;
  const totalHours = labourLines.reduce((s, l) => s + l.hours, 0);

  const exportToExcel = () => {
    const wb = XLSX.utils.book_new();
    const today = new Date().toLocaleDateString("en-CA");
    wb.Props = { Title: `${projectName || "Project"} — Cost Estimate`, Author: "VoxPlan", CreatedDate: new Date() };

    const addSheet = (name: string, rows: any[][], widths: number[]) => {
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = widths.map((w) => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, ws, name);
    };

    const header = (title: string) => [
      ["VOXPLAN — COST ESTIMATE"],
      [projectName || "Project", activePackage !== "all" ? `Package: ${activePackage}` : "All Packages"],
      [`Date: ${today}`, `Currency: CAD`, `Shift: ${hoursPerDay} hrs/day`],
      [title],
      [],
    ];

    addSheet(
      "Summary",
      [
        ...header("BID SUMMARY"),
        ["Item", "Amount (CAD)"],
        ["Labour", costExportNumber(labourTotal)],
        ["Equipment", costExportNumber(equipTotal)],
        ["Materials", costExportNumber(materialTotal)],
        ["Total Direct Cost", costExportNumber(directTotal)],
        [`Overhead (${overheadPct}%)`, costExportNumber(overhead)],
        [`Profit (${profitPct}%)`, costExportNumber(profit)],
        ["TOTAL BID PRICE (CAD)", costExportNumber(grandTotal)],
        [],
        ["Total Man-Hours", costExportNumber(totalHours)],
        ["Concrete Waste Factor", `${wastePercent}%`],
      ],
      [34, 18, 18]
    );

    addSheet(
      "Labour",
      [
        ...header(useProposal ? "LABOUR — REVIEWED DRAWING COST PROPOSAL" : "LABOUR — DERIVED FROM SCHEDULE MANPOWER"),
        ["Trade", "Activities", "Worker-Days", "Hours/Day", "Man-Hours", "Rate ($/hr)", "Cost (CAD)"],
        ...labourLines.map((l) => [
          humanize(l.trade),
          l.tasks,
          Number(l.workerDays.toFixed(1)),
          hoursPerDay,
          costExportNumber(l.hours),
          l.rate,
          costExportNumber(l.cost),
        ]),
        ["Subtotal", "", "", "", costExportNumber(totalHours), "", costExportNumber(labourTotal)],
      ],
      [24, 12, 14, 11, 13, 13, 15]
    );

    addSheet(
      "Equipment",
      [
        ...header(useProposal ? "EQUIPMENT — REVIEWED DRAWING COST PROPOSAL" : "EQUIPMENT — DERIVED FROM SCHEDULE"),
        ["Equipment", "Activities", "Days", "Hours", "Rate", "Rate Basis", "Cost (CAD)"],
        ...equipmentLines.map((e) => [
          humanize(e.key),
          e.tasks,
          Number(e.days.toFixed(1)),
          costExportNumber(e.hours),
          e.rate,
          e.unit === "day" ? "per day" : "per hour",
          costExportNumber(e.cost),
        ]),
        ["Subtotal", "", "", "", "", "", costExportNumber(equipTotal)],
      ],
      [26, 12, 10, 10, 12, 13, 15]
    );

    addSheet(
      "Materials",
      [
        ...header("MATERIALS & TAKEOFF"),
        ["Group", "Description", "Qty", "UOM", "Unit Cost", "Cost (CAD)"],
        ...materialLines.map((m) => [
          m.group,
          m.description,
          Number(m.qty.toFixed(2)),
          m.uom,
          m.unitCost,
          costExportNumber(m.cost),
        ]),
        ["Subtotal", "", "", "", "", costExportNumber(materialTotal)],
      ],
      [22, 46, 12, 8, 13, 15]
    );

    if (useProposal && costPlan) {
      addSheet("Proposal Basis", [
        ...header("REVIEWED DRAWING COST PROPOSAL — ASSUMPTIONS"),
        ["Site conditions", costPlan.context], ["Target working days", costPlan.targetDays],
        ["Scope", "Quantity", "UOM", "Person-hours/unit", "Conditions factor", "Crew", "Work-front capacity", "Source", "Assumptions"],
        ...costPlan.labour.map(l => [l.description, l.quantity, l.uom, l.hoursPerUnit, l.factor, l.workers, l.maxWorkers, l.evidence, l.assumption]),
        [], ["Equipment", "Rental days", "Units", "Rate basis", "Fixed extras", "Requirements"],
        ...costPlan.equipment.map(e => [e.name, e.days, e.units, e.basis, e.extras, e.requirement]),
        [], ["Uncertainties"], ...costPlan.uncertainties.map(s => [s]), ["Exclusions"], ...costPlan.exclusions.map(s => [s]),
      ], [45, 18, 12, 20, 18, 35, 20, 55, 70]);
      addSheet("Supplier Quotes", [
        ...header("USER-ENTERED QUOTES — NOT LIVE MARKET PRICES"),
        ["Scope", "Supplier", "Quote reference", "Valid through", "Rate CAD", "Fixed extras CAD", "Available", "Same scope"],
        ...[...costPlan.labour.map(l => ({ name: l.description, quotes: l.quotes })), ...costPlan.equipment.map(e => ({ name: e.name, quotes: e.quotes }))]
          .flatMap(l => l.quotes.map(q => [l.name, q.supplier, q.reference, q.validUntil, q.rate, q.extras, q.available ? "Yes" : "No", q.comparable ? "Yes" : "No"])),
      ], [45, 30, 24, 18, 18, 20, 16, 16]);
    }

    XLSX.writeFile(
      wb,
      `${(projectName || "project").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-")}-Cost-Estimate.xlsx`
    );
  };


  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 min-w-0">
      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Labour", value: labourTotal, icon: HardHat, sub: `${Math.round(totalHours).toLocaleString()} man-hours` },
          { label: "Equipment", value: equipTotal, icon: Truck, sub: `${equipmentLines.length} item(s) from ${useProposal ? "proposal" : "schedule"}` },
          { label: "Materials", value: materialTotal, icon: Package, sub: `${materialLines.length} takeoff line(s)` },
          { label: "Total Bid", value: grandTotal, icon: DollarSign, sub: `incl. ${overheadPct}% OH + ${profitPct}% profit` },
        ].map((c) => (
          <Card key={c.label}>
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle>
              <c.icon className="h-4 w-4 text-construction-orange" />
            </CardHeader>
            <CardContent>
              <div className="text-lg md:text-2xl font-bold break-words">{money(c.value)}</div>
              <p className="text-xs text-muted-foreground mt-1">{c.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Settings */}
      <DrawingCostPlanner projectId={projectId} activePackage={activePackage} takeoff={planningTakeoff} hoursPerDay={hoursPerDay} plan={costPlan} onChange={setCostPlan} />
      <p className="text-sm text-muted-foreground">Bid labour & equipment basis: {useProposal ? "Reviewed drawing proposal (replaces schedule allowances)" : "Scheduled manpower and equipment"}. Preset schedule rates are unverified estimating placeholders.</p>
      {proposalExcluded && (
        <p role="alert" className="text-sm text-destructive">
          The approved drawing proposal is no longer applied: {proposalStale ? "the takeoff changed since approval" : "pricing is incomplete"}. This bid currently uses scheduled manpower and equipment instead — regenerate and re-approve the proposal, or uncheck it, before exporting.
        </p>
      )}
      {useProposal && costPlan?.approvedBy && (
        <p className="text-xs text-muted-foreground">Proposal approved for bid by {costPlan.approvedBy} on {new Date(costPlan.approvedAt || "").toLocaleString("en-CA")}.</p>
      )}
      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <CardTitle className="text-base">Costing Settings (CAD)</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={load} className="gap-2">
              <RefreshCw className="h-4 w-4" /> Sync Schedule
            </Button>
            <CostProposalExport
              projectName={projectName}
              activePackage={activePackage}
              hoursPerDay={hoursPerDay}
              overheadPct={overheadPct}
              profitPct={profitPct}
              wastePercent={wastePercent}
              labourLines={labourLines}
              equipmentLines={equipmentLines}
              materialLines={materialLines}
              drawingBasis={useProposal}
              proposalNotes={useProposal && costPlan ? [...(costPlan.approvedBy ? [`Approved for bid by ${costPlan.approvedBy} on ${new Date(costPlan.approvedAt || "").toLocaleString("en-CA")}`] : []), ...costPlan.labour.map(l => `${l.description}: ${l.assumption}; ${l.evidence}`), ...costPlan.equipment.map(e => `${e.name}: ${e.requirement}`), ...costPlan.uncertainties, ...costPlan.exclusions] : []}
            />
            <Button size="sm" variant="secondary" onClick={exportToExcel} className="gap-2">
              <Download className="h-4 w-4" /> Excel
            </Button>
          </div>

        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-muted-foreground">Working hours per day</label>
            <Input
              type="number"
              value={hoursPerDay}
              onChange={(e) => setHoursPerDay(Number(e.target.value) || 0)}
              onBlur={() => saveSettings({ hours_per_day: hoursPerDay })}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Overhead %</label>
            <Input
              type="number"
              value={overheadPct}
              onChange={(e) => setOverheadPct(Number(e.target.value) || 0)}
              onBlur={() => saveSettings({ overhead_pct: overheadPct })}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Profit %</label>
            <Input
              type="number"
              value={profitPct}
              onChange={(e) => setProfitPct(Number(e.target.value) || 0)}
              onBlur={() => saveSettings({ profit_pct: profitPct })}
            />
          </div>
        </CardContent>
      </Card>

      {/* Labour */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <HardHat className="h-4 w-4 text-construction-orange" /> Labour — {useProposal ? "reviewed drawing proposal" : "from scheduled manpower"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {labourLines.length === 0 ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Info className="h-4 w-4" /> No scheduled activities yet. Build the schedule and manpower flows in here automatically.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Trade</TableHead>
                    <TableHead className="text-right">Worker-Days</TableHead>
                    <TableHead className="text-right">Man-Hours</TableHead>
                    <TableHead className="text-right w-32">Rate $/hr</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {labourLines.map((l) => (
                    <TableRow key={l.trade}>
                      <TableCell className="font-medium">
                        {humanize(l.trade)}
                        <span className="block text-xs text-muted-foreground">{l.tasks} activity(ies)</span>
                      </TableCell>
                      <TableCell className="text-right">{l.workerDays.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{Math.round(l.hours).toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          className="h-9 text-right"
                          disabled={useProposal}
                          value={useProposal ? l.rate : labourRates[l.trade] ?? l.rate}
                          onChange={(e) =>
                            setLabourRates((prev) => ({ ...prev, [l.trade]: Number(e.target.value) || 0 }))
                          }
                          onBlur={(e) => saveRate("labour", l.trade, Number(e.target.value) || 0)}
                        />
                      </TableCell>
                      <TableCell className="text-right font-semibold">{money(l.cost)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={4} className="text-right font-semibold">
                      Labour Subtotal
                    </TableCell>
                    <TableCell className="text-right font-bold text-construction-orange">{money(labourTotal)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Equipment */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Truck className="h-4 w-4 text-construction-orange" /> Equipment — {useProposal ? "reviewed drawing proposal" : "from scheduled activities"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {equipmentLines.length === 0 ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Info className="h-4 w-4" /> No equipment assigned in the schedule yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Equipment</TableHead>
                    <TableHead className="text-right">Days</TableHead>
                    <TableHead className="text-right w-28">Rate</TableHead>
                    <TableHead className="w-28">Basis</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {equipmentLines.map((e) => (
                    <TableRow key={e.key}>
                      <TableCell className="font-medium">
                        {humanize(e.key)}
                        <span className="block text-xs text-muted-foreground">{e.tasks} activity(ies)</span>
                      </TableCell>
                      <TableCell className="text-right">{e.days.toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          className="h-9 text-right"
                          value={useProposal ? e.rate : equipRates[e.key]?.rate ?? e.rate}
                          disabled={useProposal}
                          onChange={(ev) =>
                            setEquipRates((prev) => ({
                              ...prev,
                              [e.key]: { rate: Number(ev.target.value) || 0, unit: prev[e.key]?.unit || "hr" },
                            }))
                          }
                          onBlur={(ev) =>
                            saveRate("equipment", e.key, Number(ev.target.value) || 0, equipRates[e.key]?.unit || "hr")
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          disabled={useProposal}
                          value={useProposal ? e.unit : equipRates[e.key]?.unit || e.unit}
                          onValueChange={(v) => {
                            const unit = v as "hr" | "day";
                            const rate = equipRates[e.key]?.rate ?? e.rate;
                            setEquipRates((prev) => ({ ...prev, [e.key]: { rate, unit } }));
                            saveRate("equipment", e.key, rate, unit);
                          }}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="hr">per hour</SelectItem>
                            <SelectItem value="day">per day</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right font-semibold">{money(e.cost)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={4} className="text-right font-semibold">
                      Equipment Subtotal
                    </TableCell>
                    <TableCell className="text-right font-bold text-construction-orange">{money(equipTotal)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Materials */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4 text-construction-orange" /> Materials — from takeoff quantities
          </CardTitle>
        </CardHeader>
        <CardContent>
          {materialLines.length === 0 ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Info className="h-4 w-4" /> No takeoff quantities yet. Add concrete or building works items first.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>UOM</TableHead>
                    <TableHead className="text-right w-32">Unit Cost</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {materialLines.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">
                        {m.description}
                        <span className="block text-xs text-muted-foreground">{m.group}</span>
                      </TableCell>
                      <TableCell className="text-right">{m.qty.toFixed(2)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{m.uom}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          className="h-9 text-right"
                          value={m.unitCost}
                          onChange={(e) =>
                            setEstimates((prev) =>
                              prev.map((x) => (x.id === m.id ? { ...x, unit_cost: Number(e.target.value) || 0 } : x))
                            )
                          }
                          onBlur={(e) => setUnitCost(m.id, Number(e.target.value) || 0)}
                        />
                      </TableCell>
                      <TableCell className="text-right font-semibold">{money(m.cost)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={4} className="text-right font-semibold">
                      Material Subtotal
                    </TableCell>
                    <TableCell className="text-right font-bold text-construction-orange">{money(materialTotal)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            Concrete quantities include the {wastePercent}% waste factor from the takeoff.
          </p>
        </CardContent>
      </Card>

      {/* Bid roll-up */}
      <Card className="border-construction-orange/40">
        <CardHeader>
          <CardTitle className="text-base">Bid Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {[
            ["Labour", labourTotal],
            ["Equipment", equipTotal],
            ["Materials", materialTotal],
          ].map(([label, val]) => (
            <div key={label as string} className="flex justify-between">
              <span className="text-muted-foreground">{label as string}</span>
              <span>{money2(val as number)}</span>
            </div>
          ))}
          <div className="flex justify-between border-t pt-2 font-medium">
            <span>Direct Cost</span>
            <span>{money2(directTotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Overhead ({overheadPct}%)</span>
            <span>{money2(overhead)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Profit ({profitPct}%)</span>
            <span>{money2(profit)}</span>
          </div>
          <div className="flex justify-between border-t pt-3 text-lg font-bold">
            <span>Total Bid (CAD)</span>
            <span className="text-construction-orange">{money2(grandTotal)}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
