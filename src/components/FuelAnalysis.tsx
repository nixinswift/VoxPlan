import { useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { useProjectFuelPlan, useSaveProjectFuelPlan } from "@/hooks/useProjectFuelPlan";
import { useProjectHolidays } from "@/hooks/useProjectHolidays";
import { emptyFuelDuty, emptyFuelPlan, fuelExportRows, projectFuelSummary, stateLabels, type FuelTask, type ProjectFuelPlan } from "@/lib/projectFuel";
import { fuelStates, type FuelDuty } from "../../supabase/functions/_shared/fuel-duty";

const readNumber = (value: string) => value.trim() === "" ? null : Number(value);
const number = (value: number | null) => value === null ? "UNVERIFIED" : value.toLocaleString("en-CA", { maximumFractionDigits: 2 });
const money = (value: number | null) => value === null ? "UNVERIFIED"
  : value.toLocaleString("en-CA", { style: "currency", currency: "CAD" });

interface Props {
  projectId: string;
  projectName: string;
  tasks: FuelTask[];
}

export function FuelAnalysis({ projectId, projectName, tasks }: Props) {
  const saved = useProjectFuelPlan(projectId);
  const save = useSaveProjectFuelPlan(projectId);
  const { holidays, loading: loadingHolidays, error: holidayError } = useProjectHolidays(projectId);
  const [draft, setDraft] = useState<{ plan: ProjectFuelPlan; revision: number | null } | null>(null);
  const plan = draft?.plan ?? saved.data?.plan ?? emptyFuelPlan;
  const change = (edit: (value: ProjectFuelPlan) => ProjectFuelPlan) => {
    setDraft(previous => ({
      plan: edit(previous?.plan ?? saved.data?.plan ?? emptyFuelPlan),
      revision: previous ? previous.revision : saved.data?.revision ?? null,
    }));
  };

  if (saved.isPending || loadingHolidays) return <p role="status">Loading fuel plan…</p>;
  if (saved.isError || holidayError) return <p role="alert">Could not load the saved fuel plan or calendar. Review the project connection and retry.</p>;

  const summary = projectFuelSummary(tasks, plan, holidays.map(day => day.date));
  const savePlan = async () => {
    if (!draft) return;
    try {
      await save.mutateAsync(draft);
      setDraft(null);
      toast({ title: "Fuel plan saved" });
    } catch (error) {
      toast({ title: "Fuel plan could not be saved", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const exportPlan = () => {
    const workbook = XLSX.utils.book_new();
    workbook.Props = { Title: `${projectName} — Fuel Plan`, Author: "VoxPlan" };
    const worksheet = XLSX.utils.aoa_to_sheet([["Project", projectName], ...fuelExportRows(summary)]);
    worksheet["!cols"] = [{ wch: 36 }, { wch: 56 }, ...Array.from({ length: 25 }, () => ({ wch: 18 }))];
    XLSX.utils.book_append_sheet(workbook, worksheet, "Fuel");
    const fileName = projectName.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-") || "VoxPlan";
    XLSX.writeFile(workbook, `${fileName}-Fuel-Plan.xlsx`);
  };

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle>Fuel plan</CardTitle>
        <CardDescription>Scheduled diesel demand by activity and equipment. Enter state hours per machine for one operating day and cite the applicable rates. Unverified assignments have no calculated fuel value.</CardDescription>
        <div className="flex flex-wrap gap-2">
          <Button onClick={savePlan} disabled={!draft || save.isPending}>{save.isPending ? "Saving…" : "Save fuel plan"}</Button>
          <Button variant="outline" onClick={exportPlan} disabled={Boolean(draft) || !summary.rows.length}>Fuel Excel</Button>
          {draft && <Button variant="ghost" disabled={save.isPending} onClick={async () => { await saved.refetch(); setDraft(null); }}>Discard edits and reload</Button>}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <fieldset disabled={save.isPending} className="space-y-4">
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={plan.workSaturday} onChange={e => change(p => ({ ...p, workSaturday: e.target.checked }))} /> Include Saturdays</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={plan.workSunday} onChange={e => change(p => ({ ...p, workSunday: e.target.checked }))} /> Include Sundays</label>
            <span className="text-muted-foreground">Weekdays included. Project holidays excluded.</span>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm">Delivered diesel CAD/L<Input type="number" min={0} step="any" value={plan.price ?? ""} onChange={e => change(p => ({ ...p, price: readNumber(e.target.value) }))} /></label>
            <label className="text-sm">Delivered price reference<Input maxLength={2000} value={plan.priceSource} onChange={e => change(p => ({ ...p, priceSource: e.target.value }))} /></label>
            <label className="text-sm">Delivered price date<Input type="date" value={plan.priceDate} onChange={e => change(p => ({ ...p, priceDate: e.target.value }))} /></label>
          </div>
          <div className="border rounded-md p-3 space-y-1 text-sm" aria-live="polite">
            <p>Fleet diesel volume · <strong>{number(summary.totalLitres)}{summary.totalLitres === null ? "" : " L"}</strong></p>
            <p>Modeled delivered fuel cost · <strong>{money(summary.totalCost)}</strong></p>
            <p>Separately charged amount · <strong>{summary.separateCost === null ? "Pending review or included in equipment rates" : money(summary.separateCost)}</strong></p>
            {summary.unverified > 0 && <p className="text-destructive">{summary.unverified} unverified equipment assignment(s).</p>}
          </div>
          {summary.rows.length === 0 && <p className="text-sm text-muted-foreground">Assign equipment to scheduled activities to plan fuel.</p>}
          {summary.rows.map(row => {
            const duty = row.duty ?? emptyFuelDuty;
            const update = (patch: Partial<FuelDuty>) => change(p => ({
              ...p, duties: { ...p.duties, [row.id]: { ...(p.duties[row.id] ?? emptyFuelDuty), ...patch } },
            }));
            return (
              <details key={row.id} className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm">
                  <strong>{row.activity} · {row.quantity} × {row.equipment}</strong>
                  <span className="text-muted-foreground"> · {row.operatingDays} operating day(s) · {row.litres === null ? row.status : `${number(row.litres)} L`}</span>
                </summary>
                <div className="mt-3 space-y-3">
                  <label className="block text-sm">Fuel type
                    <select aria-label="Fuel type" className="ml-2 rounded-md border bg-background p-2" value={duty.fuelType} onChange={e => update({ fuelType: e.target.value as FuelDuty["fuelType"] })}>
                      <option value="">Unconfirmed</option><option value="diesel">Diesel</option><option value="non-diesel">No diesel</option>
                    </select>
                  </label>
                  {duty.fuelType && <label className="block text-sm">{duty.fuelType === "diesel" ? "Operating and climate assumptions" : "Basis for diesel exclusion"}
                    <Textarea maxLength={2000} value={duty.conditions} onChange={e => update({ conditions: e.target.value })} />
                  </label>}
                  {duty.fuelType === "diesel" && <>
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="text-sm">Make and model<Input maxLength={2000} value={duty.model} onChange={e => update({ model: e.target.value })} /></label>
                      <label className="text-sm">Engine configuration<Input maxLength={2000} value={duty.engine} onChange={e => update({ engine: e.target.value })} /></label>
                      <label className="text-sm">Ambient temperature °C<Input type="number" step="any" value={duty.temperatureC ?? ""} onChange={e => update({ temperatureC: readNumber(e.target.value) })} /></label>
                      <label className="text-sm">Shift hours per machine<Input type="number" min={0} max={24} step="any" value={duty.shiftHours ?? ""} onChange={e => update({ shiftHours: readNumber(e.target.value) })} /></label>
                      <label className="text-sm">Productive hours per machine<Input type="number" min={0} max={24} step="any" value={duty.productiveHours ?? ""} onChange={e => update({ productiveHours: readNumber(e.target.value) })} /></label>
                      <label className="text-sm">Rate source date<Input type="date" value={duty.sourceDate} onChange={e => update({ sourceDate: e.target.value })} /></label>
                    </div>
                    <label className="block text-sm">Rate sources, by state if different<Input maxLength={2000} value={duty.source} onChange={e => update({ source: e.target.value })} /></label>
                    <div className="grid gap-2 md:grid-cols-5">
                      {fuelStates.map(state => (
                        <div key={state} className="grid gap-2 rounded border p-2">
                          <strong className="text-sm">{stateLabels[state]}</strong>
                          <label className="text-xs">{stateLabels[state]} hours<Input type="number" min={0} max={24} step="any" value={duty.states[state].hours ?? ""} onChange={e => update({ states: { ...duty.states, [state]: { ...duty.states[state], hours: readNumber(e.target.value) } } })} /></label>
                          <label className="text-xs">{stateLabels[state]} L/h<Input type="number" min={0} step="any" value={duty.states[state].litresPerHour ?? ""} onChange={e => update({ states: { ...duty.states, [state]: { ...duty.states[state], litresPerHour: readNumber(e.target.value) } } })} /></label>
                        </div>
                      ))}
                    </div>
                    <label className="block text-sm">Fuel in scheduled equipment rates
                      <select aria-label="Fuel in scheduled equipment rates" className="ml-2 rounded-md border bg-background p-2" value={duty.billing} onChange={e => update({ billing: e.target.value as FuelDuty["billing"] })}>
                        <option value="">Unreviewed</option><option value="included">Already included</option><option value="separate">Excluded from rate · charge separately</option>
                      </select>
                    </label>
                  </>}
                  {row.reason && <p className="text-sm text-muted-foreground">{row.reason}</p>}
                  {row.status === "DOCUMENTED" && <p className="text-sm">{number(row.shiftHours)} scheduled machine-hours · {number(row.engineHours)} engine-hours · {number(row.productiveHours)} productive hours</p>}
                </div>
              </details>
            );
          })}
        </fieldset>
      </CardContent>
    </Card>
  );
}
