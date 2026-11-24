import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Upload, Loader2, AlertTriangle, CheckCircle2, ClipboardCheck, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Task } from "@/types/schedule";
import { exceedsDrawingFileLimit, MAX_DRAWING_FILE_MB } from "@/lib/drawingUploadLimits";
import { prepareDrawingFiles, normalizeDrawingFile } from "@/lib/prepareDrawingFiles";
import { mergeDrawingAudit } from "@/lib/drawingReview";
import { buildPlan, parseEquipment } from "@/lib/scheduleEngine";

interface Activity {
  creationId?: string;
  name: string;
  trade: string;
  manpower: number;
  equipment: string;
  duration: number;
  startDate: string;
  notes?: string;
}

interface Finding {
  type: string;
  severity: "high" | "medium" | "low";
  activity: string;
  issue: string;
  recommendation: string;
}

interface ReviewResult {
  scheduleTitle: string;
  activities: Activity[];
  findings: Finding[];
  overallScore: number;
  summary: string;
  drawingAudit?: { sheetsRead: string[]; uncertainties: string[]; exclusions: string[] };
}

interface Props {
  tasks: Task[];
  onImportTasks: (tasks: Omit<Task, "id">[]) => Promise<void> | void;
}

const severityStyles: Record<string, string> = {
  high: "bg-destructive/15 text-destructive border-destructive/30",
  medium: "bg-construction-orange/15 text-construction-orange border-construction-orange/30",
  low: "bg-muted text-muted-foreground border-border",
};

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export const ScheduleUploadReview = ({ tasks, onImportTasks }: Props) => {
  const [open, setOpen] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [mode, setMode] = useState("review");
  const [planningContext, setPlanningContext] = useState("");
  const [result, setResult] = useState<ReviewResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importLock = useRef(false);

  const equipmentFleet = () => {
    const fleet: Record<string, number> = {};
    tasks.forEach((t) =>
      parseEquipment(t.equipment)
        .forEach((e) => {
          fleet[e] = Math.max(fleet[e] ?? 1, 1);
        })
    );
    return fleet;
  };

  const runReview = async (payload: { fileName?: string; fileType?: string; fileBase64?: string; fileText?: string }, publishResult = true) => {
    if (publishResult) {
      setIsReviewing(true);
      setResult(null);
    }
    try {
      const { data, error } = await supabase.functions.invoke("review-schedule-upload", {
        body: {
          ...payload,
          mode,
          planningContext,
          equipmentFleet: equipmentFleet(),
          existingTasks: tasks.map((t) => ({
            name: t.name,
            trade: t.trade,
            manpower: t.manpower,
            equipment: t.equipment,
            duration: t.duration,
            startDate: t.startDate.toISOString().slice(0, 10),
          })),
        },
      });

      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      const reviewed = { ...data, activities: (data as ReviewResult).activities.map(a => ({ ...a, creationId: crypto.randomUUID() })) } as ReviewResult;
      if (publishResult) {
        setResult(reviewed);
        toast({
        title: "Schedule reviewed",
        description: `${(data as ReviewResult).activities.length} activities read, ${(data as ReviewResult).findings.length} deficiencies flagged.`,
        });
      }
      return reviewed;
    } catch (e) {
      console.error("Schedule review failed:", e);
      toast({
        title: "Couldn't review that schedule",
        description: e instanceof Error ? e.message : "Try a PDF, image, or paste the schedule as text.",
        variant: "destructive",
      });
    } finally {
      if (publishResult) setIsReviewing(false);
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    e.target.value = "";
    if (!selected) return;
    const file = normalizeDrawingFile(selected);

    if (exceedsDrawingFileLimit(file.size)) {
      toast({ title: "File too large", description: `Please upload a file no larger than ${MAX_DRAWING_FILE_MB} MB.`, variant: "destructive" });
      return;
    }

    const isText = file.type.startsWith("text/") || /\.(csv|txt|xml|json|md)$/i.test(file.name);
    if (isText) {
      const text = await file.text();
      await runReview({ fileName: file.name, fileText: text });
      return;
    }

    const isSupported = file.type === "application/pdf" || file.type.startsWith("image/");
    if (!isSupported) {
      toast({
        title: "Unsupported file",
        description: "Upload a PDF, image, or CSV/text export of the schedule (MPP/XER: export to PDF or CSV first).",
        variant: "destructive",
      });
      return;
    }

    setIsReviewing(true);
    setResult(null);
    try {
      const parts = await prepareDrawingFiles(file);
      let combined: ReviewResult | null = null;
      for (const part of parts) {
        const result = await runReview({ fileName: part.name, fileType: part.type, fileBase64: await toBase64(part) }, false);
        if (!result) { setResult(null); return; }
        combined = combined ? { ...result, activities: [...combined.activities, ...result.activities], findings: [...combined.findings, ...result.findings], drawingAudit: mergeDrawingAudit(combined.drawingAudit, result.drawingAudit), overallScore: Math.min(combined.overallScore, result.overallScore), summary: `${combined.summary}\n${result.summary}` } : result;
      }
      if (combined && parts.length > 1) {
        const validation = buildPlan(combined.activities.map((a, index) => ({ ...a, id: String(index), trade: a.trade as Task["trade"], startDate: new Date(`${a.startDate}T00:00:00`) })));
        const extra = validation.issues.filter(i => i.type === "equipment" || i.type === "manpower").map(i => ({ type: i.type, severity: i.severity, activity: i.taskName, issue: i.issue, recommendation: i.recommendation }));
        combined.findings.push(...extra);
        combined.overallScore = Math.max(0, 100 - combined.findings.reduce((sum, f) => sum + (f.severity === "high" ? 12 : f.severity === "medium" ? 6 : 2), 0));
        combined.drawingAudit = mergeDrawingAudit(combined.drawingAudit, { uncertainties: ["Multipart scope requires review for repeated views/BOMs and dependencies across pages before approval."] });
      }
      setResult(combined);
      if (combined) toast({
        title: combined.activities.length ? "Schedule review ready" : "Drawing needs clarification",
        description: combined.activities.length ? `${combined.activities.length} activities read, ${combined.findings.length} deficiencies flagged.` : "No activities were extracted. Review the drawing notes or upload a clearer PDF.",
        variant: combined.activities.length ? "default" : "destructive",
      });
    } catch (error) {
      toast({ title: "Couldn't prepare drawing", description: error instanceof Error ? error.message : "Try an optimized PDF.", variant: "destructive" });
    } finally { setIsReviewing(false); }
  };

  const handleImport = async () => {
    if (!result?.activities.length || importLock.current) return;
    importLock.current = true;
    setIsImporting(true);
    try {
      await onImportTasks(
        result.activities.map((a) => ({
          name: a.name,
          trade: a.trade as Task["trade"],
          manpower: Math.max(1, a.manpower || 1),
          equipment: a.equipment || "",
          duration: Math.max(1, a.duration || 1),
          startDate: new Date(`${a.startDate}T00:00:00`),
          notes: a.notes,
          creationId: a.creationId,
        }))
      );
      setOpen(false);
      setResult(null);
      setPastedText("");
    } catch (error) {
      toast({ title: "Schedule not imported", description: error instanceof Error ? error.message : "Save failed. Your reviewed activities remain available for retry.", variant: "destructive" });
    } finally {
      importLock.current = false;
      setIsImporting(false);
    }
  };

  const highCount = result?.findings.filter((f) => f.severity === "high").length ?? 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Upload className="h-4 w-4" />
          Upload Schedule / Drawings
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-construction-orange" />
            {mode === "plan" ? "Plan from drawings" : "Upload & review a schedule"}
          </DialogTitle>
          <DialogDescription>
            Upload a PDF, image, or CSV/text export. VoxPlan reads the activities and audits them for undermanning,
            trade overlap, equipment conflicts, sequence errors, and missing scope.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto pr-1">
          <Tabs value={mode} onValueChange={(value) => { setMode(value); setResult(null); }}>
            <TabsList><TabsTrigger value="review">Review schedule</TabsTrigger><TabsTrigger value="plan">Plan from drawings</TabsTrigger></TabsList>
          </Tabs>
          {mode === "plan" && <Textarea aria-label="Planning requirements" value={planningContext} onChange={(e) => setPlanningContext(e.target.value)} placeholder="Start date, available crews, shift hours, equipment, shutdown windows and scope boundaries" />}
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.csv,.txt,.md,.xml,.json,image/*"
              className="hidden"
              onChange={handleFile}
            />
            <Button onClick={() => fileInputRef.current?.click()} disabled={isReviewing} className="gap-2">
              {isReviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Choose file
            </Button>
            <Button
              variant="outline"
              disabled={isReviewing || !pastedText.trim()}
              onClick={() => runReview({ fileName: "Pasted schedule", fileText: pastedText })}
              className="gap-2"
            >
              <ClipboardCheck className="h-4 w-4" />
              Review pasted text
            </Button>
          </div>

          <Textarea
            placeholder={"Or paste the schedule here, e.g.\nDemolition — 3 workers — 4 days — starts 2026-09-01 — excavator\nSlab pour — 3 workers — 2 days — starts 2026-09-03 — concrete pump, JLG"}
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            rows={4}
            className="text-sm"
          />

          {isReviewing && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Reading the schedule and hunting for deficiencies...
            </div>
          )}

          {result && (
            <div className="space-y-4">
              <Card>
                <CardContent className="pt-4 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{result.scheduleTitle}</span>
                    <Badge variant="outline">{result.activities.length} activities</Badge>
                    <Badge variant="outline">Score {result.overallScore}/100</Badge>
                    {highCount > 0 && (
                      <Badge className={severityStyles.high}>{highCount} critical</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{result.summary}</p>
                  {result.drawingAudit && <div className="text-xs space-y-1">
                    <p>Sheets: {result.drawingAudit.sheetsRead?.join("; ")}</p>
                    {result.drawingAudit.uncertainties?.map((item, i) => <p key={i} className="text-destructive">Unconfirmed: {item}</p>)}
                    {result.drawingAudit.exclusions?.map((item, i) => <p key={i}>Excluded: {item}</p>)}
                  </div>}
                </CardContent>
              </Card>

              <div>
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  {result.findings.length > 0 ? (
                    <>
                      <AlertTriangle className="h-4 w-4 text-construction-orange" />
                      Deficiencies ({result.findings.length})
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      No deficiencies found
                    </>
                  )}
                </h3>
                <ScrollArea className="max-h-64">
                  <div className="space-y-2 pr-3">
                    {result.findings.map((f, i) => (
                      <div key={i} className={`rounded-lg border p-3 text-sm ${severityStyles[f.severity] ?? severityStyles.low}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-[10px] uppercase">{f.type}</Badge>
                          <span className="font-medium">{f.activity}</span>
                        </div>
                        <p className="text-foreground/90">{f.issue}</p>
                        <p className="text-foreground/70 mt-1">→ {f.recommendation}</p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              {result.activities.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">Activities read</h3>
                  <ScrollArea className="max-h-48">
                    <div className="space-y-1 pr-3">
                      {result.activities.map((a, i) => (
                        <div key={i} className="text-xs sm:text-sm flex flex-wrap gap-x-2 gap-y-0.5 border-b border-border pb-1">
                          <span className="font-medium">{a.name}</span>
                          <span className="text-muted-foreground">{a.trade.replace(/_/g, " ")}</span>
                          <span className="text-muted-foreground">{a.manpower} workers</span>
                          <span className="text-muted-foreground">{a.duration}d</span>
                          <span className="text-muted-foreground">{a.startDate}</span>
                          {a.equipment && <span className="text-muted-foreground">{a.equipment}</span>}
                          {a.notes && <p className="w-full text-muted-foreground">{a.notes}</p>}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                  <Button onClick={handleImport} disabled={isImporting} className="mt-3 gap-2">
                    {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Add {result.activities.length} activities to schedule
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
