import { useState, useMemo, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Loader2,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  CalendarIcon,
  Users,
  Wrench,
  Plus,
  X,
  ArrowRight,
} from "lucide-react";
import { Task } from "@/types/schedule";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { buildPlan, toISO, Issue, Plan, ResourceConstraint, parseEquipment } from "@/lib/scheduleEngine";
import { useProjectHolidays } from "@/hooks/useProjectHolidays";

interface OptimizeScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: Task[];
  projectId?: string;
  onApplySuggestion?: (taskId: string, newStartDate: Date) => void;
  onApplyPlan?: (updates: { id: string; startDate: Date }[]) => void;
}

const severityIcons = {
  high: <AlertTriangle className="w-4 h-4 text-destructive" />,
  medium: <AlertCircle className="w-4 h-4 text-yellow-500" />,
  low: <Info className="w-4 h-4 text-blue-500" />,
};

const severityColors = {
  high: "bg-destructive/10 text-destructive border-destructive/20",
  medium: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  low: "bg-blue-500/10 text-blue-600 border-blue-500/20",
};

const typeLabels: Record<string, string> = {
  sequence: "Sequence",
  manpower: "Manpower",
  gap: "Idle time",
  equipment: "Equipment",
  duration: "Duration",
  calendar: "Calendar",
  parallel: "Parallel",
};

export const OptimizeScheduleDialog = ({
  open,
  onOpenChange,
  tasks,
  projectId,
  onApplySuggestion,
  onApplyPlan,
}: OptimizeScheduleDialogProps) => {
  const { holidays } = useProjectHolidays(projectId);
  const [showConstraints, setShowConstraints] = useState(false);
  const [constraints, setConstraints] = useState<ResourceConstraint[]>([]);
  const [newConstraintType, setNewConstraintType] = useState<"workers" | "equipment">("equipment");
  const [newConstraintName, setNewConstraintName] = useState("");
  const [newConstraintAvailable, setNewConstraintAvailable] = useState("");
  const [workSaturday, setWorkSaturday] = useState(false);
  const [constructionTemplate, setConstructionTemplate] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState<number | null>(null);
  const [applying, setApplying] = useState(false);
  const [aiNotes, setAiNotes] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const { uniqueTrades, uniqueEquipment } = useMemo(() => {
    const trades = new Set<string>();
    const equipment = new Set<string>();
    tasks.forEach((t) => {
      trades.add(t.trade);
      if (t.equipment && t.equipment.trim()) {
        parseEquipment(t.equipment).forEach(e => equipment.add(e));
      }
    });
    return {
      uniqueTrades: Array.from(trades),
      uniqueEquipment: Array.from(equipment).filter((e) => e.length > 1),
    };
  }, [tasks]);

  // Deterministic plan — recomputed instantly, no AI guessing.
  const plan: Plan = useMemo(
    () =>
      buildPlan(tasks, {
        holidays: holidays.map((h) => h.date),
        workSaturday,
        constraints,
        assumeSingleEquipment: true,
        inferConstructionSequencing: constructionTemplate,
      }),
    [tasks, holidays, workSaturday, constraints, constructionTemplate]
  );

  useEffect(() => {
    if (open) setAiNotes(null);
  }, [open]);

  const addConstraint = () => {
    if (!newConstraintName.trim() || !newConstraintAvailable) return;
    setConstraints((prev) => [
      ...prev,
      {
        type: newConstraintType,
        name: newConstraintName.trim(),
        available: parseInt(newConstraintAvailable) || 0,
      },
    ]);
    setNewConstraintName("");
    setNewConstraintAvailable("");
  };

  const removeConstraint = (index: number) =>
    setConstraints((prev) => prev.filter((_, i) => i !== index));

  const movedTasks = useMemo(
    () => plan.tasks.filter((p) => p.shiftedDays !== 0).sort((a, b) => a.start.getTime() - b.start.getTime()),
    [plan]
  );

  const applyPlan = async () => {
    if (!plan.canApply || !movedTasks.length) {
      toast({ title: "Nothing to change", description: "Every activity is already optimally placed." });
      return;
    }
    setApplying(true);
    try {
      const updates = movedTasks.map((p) => ({ id: p.id, startDate: p.start }));
      if (onApplyPlan) {
        await onApplyPlan(updates);
      } else if (onApplySuggestion) {
        updates.forEach((u) => onApplySuggestion(u.id, u.startDate));
      }
      toast({
        title: "Optimized schedule applied",
        description: `${updates.length} activit${updates.length === 1 ? "y" : "ies"} rescheduled.`,
      });
    } catch (error) {
      toast({ title: "Schedule not applied", description: error instanceof Error ? error.message : "Saving failed. Review the current schedule before retrying.", variant: "destructive" });
    } finally {
      setApplying(false);
    }
  };

  const applyOne = (issue: Issue, customDate?: Date) => {
    const date = customDate || (issue.proposedStartDate ? new Date(`${issue.proposedStartDate}T00:00:00`) : null);
    if (!issue.taskId || !date) {
      toast({
        title: "Pick a date",
        description: "This finding needs a date selected before it can be applied.",
        variant: "destructive",
      });
      return;
    }
    onApplySuggestion?.(issue.taskId, date);
    setDatePickerOpen(null);
    toast({ title: "Date updated", description: `${issue.taskName} moved to ${format(date, "MMM d, yyyy")}` });
  };

  const requestAiNotes = async () => {
    setAiLoading(true);
    setAiNotes(null);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/optimize-schedule`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            mode: "review",
            constraints,
            plan: {
              score: plan.score,
              summary: plan.summary,
              originalFinish: plan.originalFinish ? toISO(plan.originalFinish) : null,
              optimizedFinish: plan.optimizedFinish ? toISO(plan.optimizedFinish) : null,
              daysSaved: plan.daysSaved,
              peakWorkers: plan.peakWorkers,
              optimizedPeakWorkers: plan.optimizedPeakWorkers,
              issues: plan.issues,
              tasks: plan.tasks.map((t) => ({
                name: t.name,
                trade: t.trade,
                phase: t.phaseLabel,
                manpower: t.manpower,
                duration: t.duration,
                equipment: t.equipment,
                currentStart: toISO(t.originalStart),
                optimizedStart: toISO(t.start),
                optimizedFinish: toISO(t.finish),
              })),
            },
          }),
        }
      );
      if (!response.ok) throw new Error("review failed");
      const data = await response.json();
      setAiNotes(data.notes || data.summary || "No additional notes.");
    } catch (e) {
      toast({
        title: "Review unavailable",
        description: "Couldn't get VoxPlan's planner notes. The optimized dates above are still valid.",
        variant: "destructive",
      });
    } finally {
      setAiLoading(false);
    }
  };

  const scoreColor =
    plan.score >= 80 ? "text-green-600" : plan.score >= 55 ? "text-yellow-600" : "text-destructive";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Schedule Optimizer
          </DialogTitle>
          <DialogDescription>
            Sequenced with a working calendar, trade phasing, crew pools and single-unit equipment
            checks — calculated locally, so the dates are always consistent.
          </DialogDescription>
        </DialogHeader>

        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6">Add activities to the schedule first.</p>
        ) : (
          <div className="space-y-4">
            {/* Score + before/after */}
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-6">
                <div>
                  <p className="text-xs text-muted-foreground">Health score</p>
                  <p className={`text-3xl font-bold ${scoreColor}`}>{plan.score}</p>
                </div>
                <Separator orientation="vertical" className="h-12 hidden sm:block" />
                <div className="text-sm">
                  <p className="text-xs text-muted-foreground">Completion</p>
                  <div className="flex items-center gap-2 font-medium">
                    <span>{plan.originalFinish ? format(plan.originalFinish, "MMM d, yyyy") : "—"}</span>
                    <ArrowRight className="w-3 h-3 text-muted-foreground" />
                    <span className={plan.daysSaved > 0 ? "text-green-600" : ""}>
                      {plan.optimizedFinish ? format(plan.optimizedFinish, "MMM d, yyyy") : "—"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {plan.daysSaved > 0
                      ? `${plan.daysSaved} working days saved`
                      : plan.daysSaved < 0
                      ? `${Math.abs(plan.daysSaved)} days added to clear conflicts`
                      : "No change to end date"}
                  </p>
                </div>
                <Separator orientation="vertical" className="h-12 hidden sm:block" />
                <div className="text-sm">
                  <p className="text-xs text-muted-foreground">Peak workforce</p>
                  <p className="font-medium">
                    {plan.peakWorkers} <ArrowRight className="w-3 h-3 inline text-muted-foreground" />{" "}
                    {plan.optimizedPeakWorkers}
                  </p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mt-3">{plan.summary}</p>
            </Card>

            {/* Options */}
            <Card className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label>Construction sequence template (assumed)</Label>
                <Switch checked={constructionTemplate} onCheckedChange={setConstructionTemplate} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Work Saturdays</Label>
                  <p className="text-xs text-muted-foreground">
                    Sundays and project holidays are always excluded.
                  </p>
                </div>
                <Switch checked={workSaturday} onCheckedChange={setWorkSaturday} />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Resource limits</Label>
                  <p className="text-xs text-muted-foreground">
                    Equipment defaults to 1 unit each. Add crew pool caps here.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setShowConstraints((s) => !s)}>
                  {showConstraints ? "Hide" : "Edit"}
                </Button>
              </div>

              {showConstraints && (
                <div className="space-y-3 pt-1">
                  <div className="flex flex-wrap gap-2">
                    {constraints.map((c, i) => (
                      <Badge key={i} variant="secondary" className="gap-1">
                        {c.type === "workers" ? <Users className="w-3 h-3" /> : <Wrench className="w-3 h-3" />}
                        {c.name}: {c.available}
                        <button onClick={() => removeConstraint(i)} className="ml-1">
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    ))}
                    {constraints.length === 0 && (
                      <p className="text-xs text-muted-foreground">No custom limits yet.</p>
                    )}
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <select
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                      value={newConstraintType}
                      onChange={(e) => setNewConstraintType(e.target.value as "workers" | "equipment")}
                    >
                      <option value="equipment">Equipment</option>
                      <option value="workers">Crew pool</option>
                    </select>
                    <Input
                      list="optimizer-resource-options"
                      placeholder={newConstraintType === "workers" ? "trade (e.g. concrete)" : "equipment (e.g. jlg)"}
                      value={newConstraintName}
                      onChange={(e) => setNewConstraintName(e.target.value)}
                      className="flex-1"
                    />
                    <datalist id="optimizer-resource-options">
                      {(newConstraintType === "workers" ? uniqueTrades : uniqueEquipment).map((o) => (
                        <option key={o} value={o} />
                      ))}
                    </datalist>
                    <Input
                      type="number"
                      min={1}
                      placeholder="available"
                      value={newConstraintAvailable}
                      onChange={(e) => setNewConstraintAvailable(e.target.value)}
                      className="sm:w-28"
                    />
                    <Button onClick={addConstraint} size="sm" className="gap-1">
                      <Plus className="w-4 h-4" /> Add
                    </Button>
                  </div>
                </div>
              )}
            </Card>

            {/* Findings */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">
                  Findings {plan.issues.length > 0 && `(${plan.issues.length})`}
                </h4>
                <Button variant="ghost" size="sm" onClick={requestAiNotes} disabled={aiLoading} className="gap-1">
                  {aiLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  VoxPlan planner notes
                </Button>
              </div>

              {plan.issues.length === 0 ? (
                <Card className="p-4 flex items-center gap-2 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  No sequencing, calendar or resource problems found.
                </Card>
              ) : (
                plan.issues.map((issue, i) => (
                  <Card key={i} className="p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      {severityIcons[issue.severity]}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className={severityColors[issue.severity]}>
                            {typeLabels[issue.type] ?? issue.type}
                          </Badge>
                          <span className="text-sm font-medium truncate">{issue.taskName}</span>
                        </div>
                        <p className="text-sm mt-1">{issue.issue}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{issue.recommendation}</p>
                      </div>
                    </div>
                    {issue.taskId && (
                      <div className="flex flex-wrap gap-2 justify-end">
                        <Popover
                          open={datePickerOpen === i}
                          onOpenChange={(o) => setDatePickerOpen(o ? i : null)}
                        >
                          <PopoverTrigger asChild>
                            <Button variant="ghost" size="sm" className="gap-1">
                              <CalendarIcon className="w-3.5 h-3.5" /> Pick date
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="end">
                            <Calendar
                              mode="single"
                              selected={
                                issue.proposedStartDate
                                  ? new Date(`${issue.proposedStartDate}T00:00:00`)
                                  : undefined
                              }
                              onSelect={(d) => d && applyOne(issue, d)}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                        {issue.proposedStartDate && (
                          <Button size="sm" variant="outline" onClick={() => applyOne(issue)}>
                            Move to {format(new Date(`${issue.proposedStartDate}T00:00:00`), "MMM d")}
                          </Button>
                        )}
                      </div>
                    )}
                  </Card>
                ))
              )}
            </div>

            {aiNotes && (
              <Card className="p-4 bg-muted/30">
                <p className="text-xs font-semibold mb-1 flex items-center gap-1">
                  VoxPlan planner notes
                </p>
                <p className="text-sm whitespace-pre-wrap">{aiNotes}</p>
              </Card>
            )}

            {/* Optimized plan preview */}
            {movedTasks.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">Optimized plan ({movedTasks.length} moves)</h4>
                <Card className="divide-y">
                  {movedTasks.map((t) => (
                    <div key={t.id} className="p-3 flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{t.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {t.phaseLabel} · {t.duration} calendar days · {t.manpower} workers
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 text-xs">
                        <span className="text-muted-foreground line-through">
                          {format(t.originalStart, "MMM d")}
                        </span>
                        <ArrowRight className="w-3 h-3" />
                        <span className="font-medium">{format(t.start, "MMM d")}</span>
                        <span className="text-muted-foreground">
                          → {format(t.finish, "MMM d")}
                        </span>
                      </div>
                    </div>
                  ))}
                </Card>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button onClick={applyPlan} disabled={applying || !plan.canApply || movedTasks.length === 0} className="gap-2">
                {applying && <Loader2 className="w-4 h-4 animate-spin" />}
                Apply optimized schedule
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
