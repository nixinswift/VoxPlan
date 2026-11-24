import { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Building2, Loader2, Download, Info, Send, Upload } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { exceedsDrawingFileLimit, MAX_DRAWING_FILE_MB } from "@/lib/drawingUploadLimits";
import { prepareDrawingFiles } from "@/lib/prepareDrawingFiles";
import { withDrawingIds, mergeDrawingAudit, approveDrawingRows, reconcileDrawingParts, reconcileUncertainties, MULTIPART_REVIEW_UNCERTAINTY } from "@/lib/drawingReview";
import type { DrawingAudit, DrawingLine } from "@/lib/drawingTakeoff";
import { calcBuildingQty } from "@/lib/buildingQuantities";
import { civilTakeoffUnit, civilVolumeBasis } from "../../supabase/functions/_shared/civil-volume";
export { calcBuildingQty } from "@/lib/buildingQuantities";

export type BuildingTrade =
  | "civil"
  | "general_conditions"
  | "demolition"
  | "parging"
  | "flashings_trims"
  | "siding_insulation"
  | "windows"
  | "doors"
  | "attic_insulation"
  | "ventilation"
  | "electrical"
  | "mechanical"
  | "eaves_downspouts"
  | "roofing"
  | "painting"
  | "landscaping_repair"
  | "other";

export type Uom = "m2" | "m3" | "t" | "m" | "ea" | "unit" | "ls";

export interface BuildingItem {
  id: string;
  trade: BuildingTrade;
  description: string;
  quantity: number;
  length: number;
  width: number;
  uom: Uom;
  notes: string;
  package: string;
}

export const tradeLabels: Record<BuildingTrade, string> = {
  civil: "Civil / Earthworks",
  general_conditions: "General Conditions",
  demolition: "Demolition",
  parging: "Parging",
  flashings_trims: "Flashings & Trims",
  siding_insulation: "Siding & Insulation",
  windows: "Windows",
  doors: "Doors",
  attic_insulation: "Attic Insulation",
  ventilation: "Ventilation",
  electrical: "Electrical",
  mechanical: "Mechanical / Industrial",
  eaves_downspouts: "Eaves & Downspouts",
  roofing: "Roofing",
  painting: "Painting",
  landscaping_repair: "Landscaping / Repairs",
  other: "Other",
};

const TRADE_ORDER: BuildingTrade[] = [
  "civil",
  "general_conditions",
  "demolition",
  "parging",
  "flashings_trims",
  "siding_insulation",
  "windows",
  "doors",
  "attic_insulation",
  "ventilation",
  "electrical",
  "mechanical",
  "eaves_downspouts",
  "roofing",
  "painting",
  "landscaping_repair",
  "other",
];

const uomLabels: Record<Uom, string> = {
  m3: "m³",
  t: "t",
  m2: "m²",
  m: "lm",
  ea: "ea",
  unit: "unit",
  ls: "LS",
};

interface Props {
  projectId: string;
  projectName: string;
  userId: string | null;
  activePackage: string;
}

export const BuildingTakeoff = ({ projectId, projectName, userId, activePackage }: Props) => {
  const [items, setItems] = useState<BuildingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTrade, setActiveTrade] = useState<BuildingTrade>("siding_insulation");
  const [scopeText, setScopeText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savingDrawing, setSavingDrawing] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [aiNote, setAiNote] = useState("");
  const [drawingDraft, setDrawingDraft] = useState<any[]>([]);
  const [drawingAudit, setDrawingAudit] = useState<{ sheetsRead?: string[]; uncertainties?: string[]; exclusions?: string[] } | null>(null);
  const abortRef = useRef(false);


  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from("estimates")
        .select("*")
        .eq("project_id", projectId)
        .eq("discipline", "building")
        .order("created_at", { ascending: true });
      if (!error && data) {
        setItems(
          (data as any[]).map((e) => ({
            id: e.id,
            trade: (e.trade || "other") as BuildingTrade,
            description: e.description || "",
            quantity: Number(e.quantity) || 1,
            length: Number(e.length) || 0,
            width: Number(e.width) || 0,
            uom: (e.uom || "ea") as Uom,
            notes: "",
            package: e.package || "",
          }))
        );
      }
      setLoading(false);
    };
    load();
    return () => {
      abortRef.current = true;
    };
  }, [projectId]);

  const saveItem = async (item: BuildingItem) => {
    if (!userId) return;
    const { error } = await supabase.from("estimates").upsert({
      id: item.id,
      project_id: projectId,
      user_id: userId,
      discipline: "building",
      category: "building",
      trade: item.trade,
      description: item.description,
      quantity: item.quantity,
      length: item.length,
      width: item.width,
      thickness: 0,
      height: 0,
      area: 0,
      uom: item.uom,
      unit_qty: calcBuildingQty(item),
      unit: "m",
      package: item.package,
    } as any);
    if (error) console.error("Save error:", error);
  };

  const addItem = (trade: BuildingTrade = activeTrade) => {
    const item: BuildingItem = {
      id: crypto.randomUUID(),
      trade,
      description: "",
      quantity: 1,
      length: 0,
      width: 0,
      uom: trade === "siding_insulation" || trade === "parging" ? "m2" : "ea",
      notes: "",
      package: activePackage === "all" ? "" : activePackage,
    };
    setItems((prev) => [...prev, item]);
    saveItem(item);
  };

  const updateItem = (id: string, updates: Partial<BuildingItem>) => {
    setItems((prev) => {
      const next = prev.map((i) => (i.id === id ? { ...i, ...updates } : i));
      const item = next.find((i) => i.id === id);
      if (item) saveItem(item);
      return next;
    });
  };

  const deleteItem = async (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    await supabase.from("estimates").delete().eq("id", id);
  };

  const addFromAI = async (aiItems: any[]) => {
    if (!userId) throw new Error("Sign in before saving quantities.");
    const fallbackPackage = activePackage === "all" ? "" : activePackage;
    const newItems: BuildingItem[] = aiItems.map((ai) => ({
      id: ai.id || crypto.randomUUID(),
      trade: (TRADE_ORDER.includes(ai.trade) ? ai.trade : "other") as BuildingTrade,
      description: ai.note ? `${ai.description || ""} — ${ai.note}` : ai.description || "",
      quantity: Number(ai.quantity) || 1,
      length: Number(ai.length) || 0,
      width: Number(ai.width) || 0,
      uom: (["m2", "m3", "t", "m", "ea", "unit", "ls"].includes(ai.uom) ? ai.uom : "ea") as Uom,
      notes: ai.note || "",
      package: ai.package || fallbackPackage,
    }));
    await approveDrawingRows(newItems.map(item => ({ id: item.id, project_id: projectId, user_id: userId, discipline: "building", category: "building", trade: item.trade, description: item.description, quantity: item.quantity, length: item.length, width: item.width, thickness: 0, height: 0, area: 0, uom: item.uom, unit_qty: calcBuildingQty(item), unit: "m", package: item.package })), async rows => supabase.from("estimates").upsert(rows as any, { onConflict: "id" }), () => setItems(prev => [...prev.filter(item => !newItems.some(saved => saved.id === item.id)), ...newItems]));
    if (newItems[0]) setActiveTrade(newItems[0].trade);
    toast({
      title: `${newItems.length} building item${newItems.length > 1 ? "s" : ""} added`,
      description: "Saved to project.",
    });
  };

  const generateFromScope = async () => {
    if (!scopeText.trim() || generating) return;
    setGenerating(true);
    setAiNote("");
    try {
      const { data, error } = await supabase.functions.invoke("building-takeoff-chat", {
        body: { messages: [{ role: "user", content: scopeText.trim() }] },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const message = data.choices?.[0]?.message;
      let added = 0;
      for (const tc of message?.tool_calls || []) {
        if (tc.function?.name === "add_building_items") {
          try {
            const args = JSON.parse(tc.function.arguments);
            if (args.items?.length) {
              await addFromAI(args.items);
              added += args.items.length;
            }
          } catch (e) {
            console.error("Failed to parse tool call", e);
          }
        }
      }
      if (message?.content) setAiNote(message.content);
      if (added === 0) {
        toast({
          title: "Nothing extracted",
          description: "Add more detail — building count, unit count, or paste the scope of work.",
          variant: "destructive",
        });
      } else {
        setScopeText("");
      }
    } catch (e: any) {
      toast({ title: "Takeoff failed", description: e.message || "Something went wrong", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const readAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(`Couldn't read ${file.name}`));
      reader.readAsDataURL(file);
    });

  const generateFromFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || uploading) return;
    const files = Array.from(fileList).slice(0, 5);
    const tooBig = files.find((f) => exceedsDrawingFileLimit(f.size));
    if (tooBig) {
      toast({ title: "File too large", description: `${tooBig.name} is over ${MAX_DRAWING_FILE_MB} MB.`, variant: "destructive" });
      return;
    }

    setUploading(true);
    setDrawingDraft([]);
    setDrawingAudit(null);
    setAiNote("");
    setUploadStatus(`Reading ${files.length} file${files.length > 1 ? "s" : ""}...`);
    try {
      const prepared: File[] = [];
      const sourceOf = new Map<File, string>();
      for (const [i, file] of files.entries()) {
        for (const part of await prepareDrawingFiles(file)) { prepared.push(part); sourceOf.set(part, `${i}:${file.name}`); }
      }
      setUploadStatus("VoxPlan is reading the drawings and measuring quantities...");
      let added = 0;
      // Parts are analyzed independently, so collect everything first, then
      // reconcile: identical lines repeated across parts are counted once.
      const collected: { source: string; lines: DrawingLine[] }[] = [];
      let audits: DrawingAudit | null = null;
      const notes: string[] = [];
      for (const f of prepared) {
        const mimeType = f.type || (f.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "text/plain");
        let attachment;
        if (mimeType.startsWith("image/") || mimeType === "application/pdf") {
          attachment = { name: f.name, mimeType, dataUrl: await readAsDataUrl(f) };
        } else {
          attachment = { name: f.name, mimeType: "text/plain", dataUrl: "text", text: await f.text() };
        }
      const { data, error } = await supabase.functions.invoke("building-takeoff-chat", {
        body: {
          messages: [
            {
              role: "user",
              content: `Produce a complete measured building-works takeoff from the attached documents (${files
                .map((f) => f.name)
                .join(", ")}). Cover every trade in scope and note any assumption you make.${
                scopeText.trim() ? `\n\nAdditional context: ${scopeText.trim()}` : ""
              }`,
            },
          ],
          files: [attachment],
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const message = data.choices?.[0]?.message;
      // One entry per analyzed part: lines inside a part are never merged with each other.
      const partLines: DrawingLine[] = [];
      collected.push({ source: sourceOf.get(f) ?? f.name, lines: partLines });
      for (const tc of message?.tool_calls || []) {
        if (tc.function?.name === "add_building_items") {
          try {
            const args = JSON.parse(tc.function.arguments);
            if (args.items?.length) {
              partLines.push(...args.items);
              added += args.items.length;
            }
            // Audits are retained even when a part produced no items — an
            // unquantifiable part's uncertainties must not disappear.
            if (args.drawingAudit) audits = mergeDrawingAudit(audits, args.drawingAudit);
          } catch (e) {
            console.error("Failed to parse tool call", e);
          }
        }
      }
      if (message?.content) notes.push(message.content);
      }
      if (prepared.length > 1) audits = mergeDrawingAudit(audits, { uncertainties: [MULTIPART_REVIEW_UNCERTAINTY] });
      const reconciled = reconcileDrawingParts(collected);
      const lines = reconciled.lines;
      const reconcileNotes = reconcileUncertainties(reconciled);
      if (reconcileNotes.length) audits = mergeDrawingAudit(audits, { uncertainties: reconcileNotes });
      setDrawingDraft(withDrawingIds(lines));
      setDrawingAudit(audits);
      if (notes.length) setAiNote(notes.join("\n"));
      if (added === 0) {
        toast({
          title: "Nothing extracted",
          description: "VoxPlan couldn't read measurable scope from those files. Try clearer drawings or add context above.",
          variant: "destructive",
        });
      } else {
        setScopeText("");
        toast({ title: `Drawing review ready`, description: `${added} proposed line items — review before saving.` });
      }
    } catch (e: any) {
      toast({ title: "Takeoff failed", description: e.message || "Something went wrong", variant: "destructive" });
      setDrawingAudit(prev => mergeDrawingAudit(prev, { uncertainties: ["Drawing analysis did not complete. Retained lines do not represent the full uploaded scope."] }));
    } finally {
      setUploading(false);
      setUploadStatus("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };


  const takeoffUnit = (item: BuildingItem) => item.trade === "civil" && item.uom === "m3"
    ? civilTakeoffUnit(item.trade, item.uom, item.description) : uomLabels[item.uom];
  const quantitySummary = (lines: BuildingItem[], precision: number, separator: string) => {
    const byUom = new Map<string, number>();
    let unverified = 0;
    for (const line of lines) {
      if (line.trade === "civil" && line.uom === "m3" && !civilVolumeBasis(line.description)) {
        unverified += 1;
        continue;
      }
      const unit = takeoffUnit(line);
      byUom.set(unit, (byUom.get(unit) ?? 0) + calcBuildingQty(line));
    }
    const results = [...byUom].map(([uom, value]) => `${value.toFixed(precision)} ${uom}`);
    if (unverified) results.push(`${unverified} line(s) need volume basis`);
    return results.join(separator);
  };

  const filtered = activePackage === "all" ? items : items.filter((i) => i.package === activePackage);
  const tradeItems = filtered.filter((i) => i.trade === activeTrade);
  const activeTrades = TRADE_ORDER.filter((t) => filtered.some((i) => i.trade === t));

  const exportToExcel = () => {
    const wb = XLSX.utils.book_new();
    const rows = filtered.map((i) => ({
      Package: i.package || "(none)",
      Trade: tradeLabels[i.trade],
      Description: i.description,
      Qty: i.quantity,
      "Length or quantity per occurrence (UOM)": i.length || "",
      "Width/Height (m)": i.width || "",
      UOM: takeoffUnit(i),
      "Measured Qty": parseFloat(calcBuildingQty(i).toFixed(2)),
      Notes: i.notes,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Building Works");

    const summary = TRADE_ORDER.filter((t) => filtered.some((i) => i.trade === t)).map((t) => {
      const ti = filtered.filter((i) => i.trade === t);
      return { Trade: tradeLabels[t], Items: ti.length, Quantities: quantitySummary(ti, 2, ", ") };
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Trade Summary");

    const filename = `${projectName || "Estimate"}_BuildingWorks_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, filename);
    toast({ title: "Exported", description: `Saved as ${filename}` });
  };

  if (loading) {
    return (
      <div className="py-16 flex justify-center">
        <Building2 className="h-10 w-10 animate-pulse text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Scope-to-takeoff */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            Drawings &amp; Scope to Takeoff
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Drawing / spec upload */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              generateFromFiles(e.dataTransfer.files);
            }}
            onClick={() => !uploading && fileInputRef.current?.click()}
            className={`rounded-lg border-2 border-dashed p-5 text-center cursor-pointer transition-colors ${
              dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
            } ${uploading ? "opacity-70 pointer-events-none" : ""}`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="application/pdf,image/*,.txt,.csv"
              className="hidden"
              onChange={(e) => generateFromFiles(e.target.files)}
            />
            {uploading ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-6 w-6 animate-spin text-construction-orange" />
                <p className="text-sm font-medium">{uploadStatus || "Working..."}</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1">
                <Upload className="h-6 w-6 text-construction-orange" />
                <p className="text-sm font-medium">Upload drawings or specs — get an instant estimate</p>
                <p className="text-xs text-muted-foreground">
                  Drop PDFs, plan images, or scope documents (up to 5 files, {MAX_DRAWING_FILE_MB} MB each)
                </p>
              </div>
            )}
          </div>


          <Textarea
            value={scopeText}
            onChange={(e) => setScopeText(e.target.value)}
            placeholder={
              'Paste a scope of work, or describe it: "Building envelope upgrade, 24 townhouse units — new Hardie siding, 3/8" fanfold insulation, Tyvek, all windows and doors, attic insulation to 18\\", new eaves, parging, flashings, doorbells and lights."'
            }
            className="min-h-[110px] text-sm"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Generates a trade-by-trade quantity takeoff using building-code and industry defaults.
            </p>
            <Button onClick={generateFromScope} disabled={generating || !scopeText.trim()} className="gap-2">
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {generating ? "Building takeoff..." : "Generate Takeoff"}
            </Button>
          </div>
          {aiNote && <div className="text-sm bg-muted rounded-lg p-3 whitespace-pre-wrap">{aiNote}</div>}
        </CardContent>
      </Card>

      {/* Trade summary cards */}
      {drawingDraft.length > 0 && <section className="space-y-3 border-t pt-4">
        <h3 className="font-semibold">Drawing takeoff review</h3>
        {drawingAudit && <div className="text-sm space-y-1">
          <p className="text-muted-foreground">Sheets: {drawingAudit.sheetsRead?.join("; ")}</p>
          {drawingAudit.uncertainties?.map((item, i) => <p key={i} className="text-destructive">Unconfirmed: {item}</p>)}
          {drawingAudit.exclusions?.map((item, i) => <p key={i} className="text-muted-foreground">Excluded: {item}</p>)}
        </div>}
        {drawingDraft.map((item, index) => <div key={index} className="border-b py-2 flex gap-3 items-start">
          <div className="flex-1 min-w-0 text-sm"><p className="font-medium">{item.description}</p><p>{item.quantity} × {item.uom === "m" ? `${item.length} m` : item.uom === "m2" ? `${item.length} × ${item.width} m²` : item.uom}</p><p className="text-muted-foreground break-words">{item.note}</p></div>
          <Button variant="ghost" size="icon" aria-label={`Remove proposed item ${index + 1}`} onClick={() => setDrawingDraft((prev) => prev.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
        </div>)}
        <div className="flex gap-2"><Button disabled={savingDrawing || uploading} onClick={async () => { setSavingDrawing(true); try { await addFromAI(drawingDraft); setDrawingDraft([]); } catch (error) { toast({ title: "Drawing not saved", description: error instanceof Error ? error.message : "Save failed; the review is retained.", variant: "destructive" }); } finally { setSavingDrawing(false); } }}>Save {drawingDraft.length} reviewed items</Button><Button disabled={savingDrawing || uploading} variant="outline" onClick={() => { setDrawingDraft([]); setDrawingAudit(null); }}>Discard</Button></div>
      </section>}
      {activeTrades.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {activeTrades.map((t) => {
            const ti = filtered.filter((i) => i.trade === t);
            return (
              <Card
                key={t}
                className={`cursor-pointer transition-all ${activeTrade === t ? "ring-2 ring-primary" : "hover:border-primary/40"}`}
                onClick={() => setActiveTrade(t)}
              >
                <CardContent className="p-3">
                  <p className="text-xs font-medium text-muted-foreground truncate">{tradeLabels[t]}</p>
                  <p className="text-xl font-bold">{ti.length}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {quantitySummary(ti, 1, " · ")}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Line item table */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Select value={activeTrade} onValueChange={(v) => setActiveTrade(v as BuildingTrade)}>
                <SelectTrigger className="h-9 w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRADE_ORDER.map((t) => (
                    <SelectItem key={t} value={t}>
                      {tradeLabels[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">{tradeItems.length} line items</span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-2" onClick={exportToExcel} disabled={filtered.length === 0}>
                <Download className="h-4 w-4" /> Export Excel
              </Button>
              <Button size="sm" onClick={() => addItem()}>
                <Plus className="h-4 w-4 mr-1" /> Add Item
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {tradeItems.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Building2 className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p>No {tradeLabels[activeTrade]} items yet. Paste a scope above or add a line.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Package</TableHead>
                    <TableHead className="min-w-[200px]">Description</TableHead>
                    <TableHead className="w-20">Qty</TableHead>
                    <TableHead className="w-24">Length / per unit</TableHead>
                    <TableHead className="w-24">W/H (m)</TableHead>
                    <TableHead className="w-24">UOM</TableHead>
                    <TableHead className="w-28 text-right">Measured</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tradeItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Input
                          placeholder="e.g., Building A"
                          value={item.package}
                          onChange={(e) => updateItem(item.id, { package: e.target.value })}
                          className="h-8 w-24 text-xs"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {item.notes && (
                            <button
                              type="button"
                              className="shrink-0 text-blue-500 hover:text-blue-400"
                              title={item.notes}
                              onClick={() => toast({ title: "ℹ️ Assumption", description: item.notes, duration: 8000 })}
                            >
                              <Info className="h-4 w-4" />
                            </button>
                          )}
                          <Input
                            value={item.description}
                            placeholder="e.g., Hardie siding - front elevation"
                            onChange={(e) => updateItem(item.id, { description: e.target.value })}
                            className="h-8"
                          />
                        </div>
                        {item.trade === "mechanical" && <p className="text-xs text-muted-foreground whitespace-normal break-words mt-1">{item.description}</p>}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={item.quantity}
                          onChange={(e) => updateItem(item.id, { quantity: Number(e.target.value) || 0 })}
                          className="h-8 w-16"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={item.length || ""}
                          aria-label={item.uom === "m3" || item.uom === "t" ? `Quantity per occurrence (${uomLabels[item.uom]})` : "Length (m)"}
                          onChange={(e) => updateItem(item.id, { length: Number(e.target.value) || 0 })}
                          className="h-8 w-20"
                          disabled={item.uom === "ea" || item.uom === "unit" || item.uom === "ls"}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={item.width || ""}
                          onChange={(e) => updateItem(item.id, { width: Number(e.target.value) || 0 })}
                          className="h-8 w-20"
                          disabled={item.uom !== "m2"}
                        />
                      </TableCell>
                      <TableCell>
                        <Select value={item.uom} onValueChange={(v) => updateItem(item.id, { uom: v as Uom })}>
                          <SelectTrigger className="h-8 w-20">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(uomLabels) as Uom[]).map((u) => (
                              <SelectItem key={u} value={u}>
                                {uomLabels[u]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        {calcBuildingQty(item).toFixed(2)} {takeoffUnit(item)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:bg-destructive/10"
                          onClick={() => deleteItem(item.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell colSpan={6} className="text-right">
                      Subtotal ({tradeLabels[activeTrade]})
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {quantitySummary(tradeItems, 2, " · ")}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
