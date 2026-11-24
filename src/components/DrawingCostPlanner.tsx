import { useEffect, useState } from "react";
import { Calculator, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { labourEffort, pricePlan, rankQuotes, takeoffFingerprint, type CostPlan, type CostQuote, type CostTakeoff } from "@/lib/costPlanning";
import type { Json } from "@/integrations/supabase/types";
import { collectCostProposalBatches } from "@/lib/costProposalBatches";

const money = (n: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n);
const numeric = (value: string) => Math.max(0, Number(value) || 0);

function Quotes({ quotes, quantity, basis, onChange }: { quotes: CostQuote[]; quantity: number; basis: string; onChange: (quotes: CostQuote[]) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const ranked = rankQuotes(quotes, quantity, today);
  const update = (id: string, patch: Partial<CostQuote>) => onChange(quotes.map(q => q.id === id ? { ...q, ...patch } : q));
  return <details className="mt-3 border-t pt-2">
    <summary className="cursor-pointer text-sm font-medium">Supplier quotes ({quotes.length}){ranked[0] ? ` · Lowest comparable: ${money(ranked[0].total)} — ${ranked[0].supplier}` : " · No verified comparable quote"}</summary>
    <div className="space-y-3 py-3">
      {quotes.map(q => <div key={q.id} className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-2 border-b pb-3">
        <label className="text-xs">Supplier<Input aria-label="Quote supplier" value={q.supplier} onChange={e => update(q.id, { supplier: e.target.value })} /></label>
        <label className="text-xs">Quote reference<Input aria-label="Quote reference" value={q.reference} onChange={e => update(q.id, { reference: e.target.value })} /></label>
        <label className="text-xs">Valid through<Input aria-label="Quote valid through" type="date" value={q.validUntil} onChange={e => update(q.id, { validUntil: e.target.value })} /></label>
        <label className="text-xs">CAD / {basis}<Input aria-label="Quote rate" type="number" min={0} value={q.rate} onChange={e => update(q.id, { rate: numeric(e.target.value) })} /></label>
        <label className="text-xs">Fixed extras CAD<Input aria-label="Quote extras" type="number" min={0} value={q.extras} onChange={e => update(q.id, { extras: numeric(e.target.value) })} /></label>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs"><Checkbox checked={q.available} onCheckedChange={v => update(q.id, { available: v === true })} />Available for dates</label>
          <label className="flex items-center gap-2 text-xs"><Checkbox checked={q.comparable} onCheckedChange={v => update(q.id, { comparable: v === true })} />Same scope / inclusions</label>
          <Button size="icon" variant="ghost" title="Remove quote" aria-label="Remove quote" onClick={() => onChange(quotes.filter(x => x.id !== q.id))}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>)}
      <Button size="sm" variant="outline" onClick={() => onChange([...quotes, { id: crypto.randomUUID(), supplier: "", reference: "", validUntil: "", rate: 0, extras: 0, available: false, comparable: false }])}><Plus className="h-4 w-4 mr-2" />Add supplier quote</Button>
    </div>
  </details>;
}

interface Props {
  projectId: string;
  activePackage: string;
  takeoff: CostTakeoff[];
  hoursPerDay: number;
  plan: CostPlan | null;
  approvalBasis: string;
  approvalSaved: boolean;
  onChange: (plan: CostPlan | null, saved: boolean) => void;
}

export function DrawingCostPlanner({ projectId, activePackage, takeoff, hoursPerDay, plan, approvalBasis, approvalSaved, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [saving, setSaving] = useState(false);
  const [context, setContext] = useState("");
  const [targetDays, setTargetDays] = useState(20);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const fingerprint = takeoffFingerprint(takeoff);
  const stale = Boolean(plan && plan.fingerprint !== fingerprint);
  const approvalStale = Boolean(plan?.useInBid && plan.approvedBasis !== approvalBasis);
  const priced = plan ? pricePlan(plan, hoursPerDay, new Date().toISOString().slice(0, 10)) : null;

  useEffect(() => {
    let cancelled = false;
    setLoaded(false); setDirty(false); onChange(null, false);
    supabase.from("project_cost_proposals").select("proposal,package").eq("project_id", projectId).maybeSingle().then(({ data, error }) => {
      if (cancelled) return;
      if (error) toast({ title: "Couldn't load cost proposal", description: error.message, variant: "destructive" });
      if (data?.package === activePackage) {
        const saved = data.proposal as unknown as CostPlan;
        if (Array.isArray(saved.labour) && Array.isArray(saved.equipment)) {
          onChange(saved, true); setContext(saved.context || ""); setTargetDays(saved.targetDays || 20);
        }
      }
      setLoaded(true);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, activePackage]);

  const change = (next: CostPlan) => {
    onChange(next.useInBid ? next : { ...next, approvedBy: undefined, approvedAt: undefined, approvedBasis: undefined }, false);
    setDirty(true);
  };
  const generate = async () => {
    if (dirty && !window.confirm("Replace your unsaved proposal edits?")) return;
    setBusy(true);
    setCompleted(0);
    try {
      const data = await collectCostProposalBatches(async offset => {
      const { data, error } = await supabase.functions.invoke("plan-drawing-costs", { body: { projectId, package: activePackage, context, hoursPerDay, targetDays, offset } });
      if (error || data?.error) {
        let message = data?.error || error?.message || "Please try again.";
        if (error && "context" in error && error.context instanceof Response) {
          const body = await error.context.json().catch(() => null);
          message = body?.error || message;
        }
        throw new Error(message);
      }
      return data;
      }, setCompleted);
      change({ ...data, context, targetDays, fingerprint, useInBid: false });
      toast({ title: "Cost proposal ready for review", description: "Productivity is provisional. Add fully loaded rates or documented quotes." });
    } catch (error) { toast({ title: "Couldn't prepare cost proposal", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!plan) return;
    setSaving(true);
    const readyToApprove = plan.useInBid && !stale && !approvalStale && priced?.complete;
    const toSave = readyToApprove ? plan
      : { ...plan, useInBid: false, approvedBy: undefined, approvedAt: undefined, approvedBasis: undefined };
    const { data, error } = await supabase.from("project_cost_proposals")
      .upsert({ project_id: projectId, package: activePackage, proposal: toSave as unknown as Json, updated_at: new Date().toISOString() })
      .select("proposal").maybeSingle();
    setSaving(false);
    if (error || !data) {
      toast({ title: "Couldn't save proposal", description: error?.message ?? "No saved proposal was returned.", variant: "destructive" });
    } else {
      onChange(data.proposal as unknown as CostPlan, true);
      setDirty(false);
      toast({ title: "Cost proposal saved" });
    }
  };
  return <section className="space-y-4 border-y py-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold flex items-start gap-2 min-w-0"><Calculator className="h-5 w-5 shrink-0 text-primary" /><span className="min-w-0 break-words">Drawing-based crew & equipment proposal</span></h2>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!plan || saving || !loaded || busy} onClick={save}>{saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}Save proposal{dirty ? " *" : ""}</Button>
        <Button disabled={busy || saving || !loaded || !takeoff.length || hoursPerDay <= 0 || targetDays <= 0} onClick={generate}>{busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Calculator className="h-4 w-4 mr-2" />}{busy ? "VoxPlan is planning…" : plan ? "Regenerate proposal" : "Prepare cost proposal"}</Button>
      </div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-4">
      <label className="text-sm">Site conditions & installation scope<Textarea aria-label="Cost planning conditions" disabled={saving} placeholder="Location, pipe class/diameters, shop vs site fabrication, elevation/access, shutdown windows, available crews and equipment…" value={context} onChange={e => { setContext(e.target.value); if (plan) change({ ...plan, context: e.target.value, useInBid: false }); }} /></label>
      <label className="text-sm">Target working days<Input aria-label="Target working days" disabled={saving} type="number" min={1} max={10000} value={targetDays} onChange={e => { const value = Math.floor(numeric(e.target.value)); setTargetDays(value); if (plan) change({ ...plan, targetDays: value, useInBid: false }); }} /></label>
    </div>
    <p className="text-xs text-muted-foreground">Basis: {takeoff.length} saved takeoff lines · {hoursPerDay} hours/shift · CAD. Productivity and equipment are provisional; rates are not live market prices. Lowest comparable quote is not a guaranteed lowest-market price.</p>
    {busy && <p role="status" className="text-sm text-muted-foreground">VoxPlan is planning in smaller groups: {Math.min(completed, takeoff.length)} / {takeoff.length} lines completed.</p>}
    {stale && <p role="alert" className="text-sm text-destructive">The takeoff changed. Regenerate this proposal before using it in your bid.</p>}
    {approvalStale && <p role="alert" className="text-sm text-destructive">Schedule, cost inputs or quote selection changed since approval. Review and save a new approval.</p>}
    {plan && <fieldset disabled={saving} className="space-y-4">
      <div className="flex flex-wrap gap-6 border-b pb-3 text-sm"><span>Proposed labour: <strong>{money(priced?.labourTotal ?? 0)}</strong></span><span>Proposed equipment: <strong>{money(priced?.equipmentTotal ?? 0)}</strong></span><span className="text-muted-foreground">{priced?.complete ? "Priced allowances — review required" : "Incomplete pricing / productivity"}</span></div>
      <h3 className="font-semibold">Labour productivity & crew</h3>
      {plan.labour.map((line, index) => {
        const effort = labourEffort(line, hoursPerDay, targetDays);
        const update = (patch: Partial<typeof line>) => change({ ...plan, useInBid: false, labour: plan.labour.map(l => l.id === line.id ? { ...l, ...patch } : l) });
        return <div key={line.id} className="border-b pb-4 space-y-2">
          <div className="flex justify-between gap-3"><strong className="text-sm break-words">{line.description}</strong><span className="text-sm shrink-0">{money(priced?.labour[index]?.cost ?? 0)}</span></div>
          <p className="text-xs text-muted-foreground break-words">{line.quantity} {line.uom} · {line.evidence || "Source reference not available"}</p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <label className="text-xs">Person-hours / {line.uom}<Input aria-label={`Productivity ${index + 1}`} type="number" min={0} step="0.01" value={line.hoursPerUnit} onChange={e => update({ hoursPerUnit: numeric(e.target.value) })} /></label>
            <label className="text-xs">Conditions factor<Input aria-label={`Conditions factor ${index + 1}`} type="number" min="0.1" step="0.1" value={line.factor} onChange={e => update({ factor: numeric(e.target.value) })} /></label>
            <label className="text-xs">Crew workers<Input aria-label={`Crew workers ${index + 1}`} type="number" min={1} value={line.workers} onChange={e => update({ workers: Math.max(1, Math.floor(numeric(e.target.value))) })} /></label>
            <label className="text-xs">Work-front capacity<Input aria-label={`Work-front capacity ${index + 1}`} type="number" min={1} value={line.maxWorkers} onChange={e => update({ maxWorkers: Math.max(1, Math.floor(numeric(e.target.value))) })} /></label>
            <label className="text-xs">Loaded CAD / person-hour<Input aria-label={`Loaded labour rate ${index + 1}`} type="number" min={0} value={line.rate} onChange={e => update({ rate: numeric(e.target.value) })} /></label>
          </div>
          <label className="block text-xs">Craft mix<Input aria-label={`Craft mix ${index + 1}`} value={line.crewMix} onChange={e => update({ crewMix: e.target.value })} /></label>
          <label className="block text-xs">Productivity basis & assumptions<Textarea aria-label={`Labour assumptions ${index + 1}`} value={line.assumption} onChange={e => update({ assumption: e.target.value })} /></label>
          <p className="text-xs">{effort.hours.toFixed(1)} person-hours · {effort.days.toFixed(1)} crew working days · {effort.requiredWorkers} workers to meet target (per scope, not a pooled workforce).</p>
          {(effort.capacityExceeded || line.workers > line.maxWorkers) && <p role="alert" className="text-xs text-destructive">Crew requirement exceeds work-front capacity; revise sequencing, shifts, access or deadline.</p>}
          <Quotes quotes={line.quotes} quantity={effort.hours} basis="person-hour (fully loaded)" onChange={quotes => update({ quotes })} />
        </div>;
      })}
      <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Equipment & rental allowances</h3><Button size="sm" variant="outline" onClick={() => change({ ...plan, useInBid: false, equipment: [...plan.equipment, { id: crypto.randomUUID(), name: "Equipment allowance", days: 0, units: 1, rate: 0, basis: "day", extras: 0, requirement: "Capacity, reach, dates and availability require confirmation.", quotes: [] }] })}><Plus className="h-4 w-4 mr-2" />Add equipment</Button></div>
      {plan.equipment.map((line, index) => {
        const update = (patch: Partial<typeof line>) => change({ ...plan, useInBid: false, equipment: plan.equipment.map(l => l.id === line.id ? { ...l, ...patch } : l) });
        return <div key={line.id} className="border-b pb-4 space-y-3">
          <div className="flex gap-3 items-center"><Input aria-label={`Equipment name ${index + 1}`} value={line.name} onChange={e => update({ name: e.target.value })} /><strong className="shrink-0 text-sm">{money(priced?.equipment[index]?.cost ?? 0)}</strong><Button size="icon" variant="ghost" aria-label={`Remove equipment ${index + 1}`} title="Remove equipment" onClick={() => change({ ...plan, useInBid: false, equipment: plan.equipment.filter(l => l.id !== line.id) })}><Trash2 className="h-4 w-4" /></Button></div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <label className="text-xs">Rental working days<Input aria-label={`Equipment days ${index + 1}`} type="number" min={0} value={line.days} onChange={e => update({ days: numeric(e.target.value) })} /></label>
            <label className="text-xs">Units<Input aria-label={`Equipment units ${index + 1}`} type="number" min={1} value={line.units} onChange={e => update({ units: Math.max(1, Math.floor(numeric(e.target.value))) })} /></label>
            <label className="text-xs">Rate CAD<Input aria-label={`Equipment rate ${index + 1}`} type="number" min={0} value={line.rate} onChange={e => update({ rate: numeric(e.target.value) })} /></label>
            <label className="text-xs">Rate basis<Select value={line.basis} onValueChange={v => update({ basis: v as "hr" | "day" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="day">Per day</SelectItem><SelectItem value="hr">Per hour</SelectItem></SelectContent></Select></label>
            <label className="text-xs">Delivery / fuel / extras CAD<Input aria-label={`Equipment extras ${index + 1}`} type="number" min={0} value={line.extras} onChange={e => update({ extras: numeric(e.target.value) })} /></label>
          </div>
          <Textarea aria-label={`Equipment requirements ${index + 1}`} value={line.requirement} onChange={e => update({ requirement: e.target.value })} />
          <Quotes quotes={line.quotes} quantity={line.days * line.units * (line.basis === "hr" ? hoursPerDay : 1)} basis={line.basis === "hr" ? "hour" : "day"} onChange={quotes => update({ quotes })} />
        </div>;
      })}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        <div><h4 className="font-semibold mb-2">Missing evidence & confirmations</h4><ul className="list-disc pl-4 space-y-1">{plan.uncertainties.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
        <div><h4 className="font-semibold mb-2">Exclusions</h4><ul className="list-disc pl-4 space-y-1">{plan.exclusions.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
      </div>
      <label className="flex items-start gap-3 border-t pt-4 text-sm">
        <Checkbox aria-label="Use reviewed proposal in bid" checked={plan.useInBid && !stale && !approvalStale && Boolean(priced?.complete)}
          disabled={saving || stale || !priced?.complete} onCheckedChange={v => {
            change({ ...plan, useInBid: v === true, approvedBasis: v === true ? approvalBasis : undefined });
          }} />
        <span>I reviewed productivity, rates, scope and equipment requirements. Save the approval to use these allowances in the estimate.</span>
      </label>
      {approvalSaved && plan.useInBid && !approvalStale && plan.approvedBy && <p className="text-xs text-muted-foreground">Approval recorded for {plan.approvedBy} on {new Date(plan.approvedAt || "").toLocaleString("en-CA")}.</p>}
      <p className="text-xs text-muted-foreground">Schedule activities remain unchanged. Material costs remain separate. Quotes include only the extras entered; confirm payroll burden, overtime, travel, operators, fuel, rental minimums and taxes.</p>
    </fieldset>}
  </section>;
}