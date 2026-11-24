import { useState, useRef, useEffect, useCallback } from "react";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Calculator, Send, MessageSquare, X, Mic, MicOff, BarChart3, PieChart, TrendingUp, ArrowLeft, Upload, FileImage, Loader2, AlertTriangle, Info, Download, FileText, Building2, DollarSign } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BuildingTakeoff, calcBuildingQty, type BuildingItem, type BuildingTrade, type Uom } from "@/components/BuildingTakeoff";
import { SpecsChat } from "@/components/SpecsChat";
import { ProposalExport } from "@/components/ProposalExport";
import { CostEstimate } from "@/components/CostEstimate";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { PieChart as RePieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { Progress } from "@/components/ui/progress";
import { readDrawingTakeoff, type DrawingLine, type DrawingAudit } from "@/lib/drawingTakeoff";
import { exceedsDrawingFileLimit, MAX_DRAWING_FILE_MB } from "@/lib/drawingUploadLimits";
import { prepareDrawingFiles, normalizeDrawingFile } from "@/lib/prepareDrawingFiles";
import { concreteVolumeM3, cubicMetresToYards, formatConcreteVolume, concreteAreaM2 } from "@/lib/concreteQuantities";
import { withDrawingIds, approveDrawingRows, reconcileDrawingParts, reconcileUncertainties, MULTIPART_REVIEW_UNCERTAINTY } from "@/lib/drawingReview";

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

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const categoryLabels: Record<ConcreteCategory, string> = {
  slab: "Concrete Slab",
  footing: "Concrete Footing",
  wall: "Concrete Wall"
};

const calcVolume = concreteVolumeM3;
const formatVol = formatConcreteVolume;

const ProjectEstimate = () => {
  const { projectId } = useParams<{projectId: string;}>();
  const navigate = useNavigate();
  const [projectName, setProjectName] = useState("");
  const [items, setItems] = useState<ConcreteItem[]>([]);
  const [dbPackages, setDbPackages] = useState<string[]>([]);
  const [activeCategory, setActiveCategory] = useState<ConcreteCategory>("slab");
  const [activePackage, setActivePackage] = useState<string>("all");
  const [activeDiscipline, setActiveDiscipline] = useState<string>("concrete");
  const [buildingRefreshKey, setBuildingRefreshKey] = useState(0);
  const [newPackageName, setNewPackageName] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceCheckRef = useRef<number | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const SILENCE_THRESHOLD = 15;
  const SILENCE_TIMEOUT = 2000;
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [wastePercent, setWastePercent] = useState(5);
  const [analyzeProgress, setAnalyzeProgress] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [drawingDraft, setDrawingDraft] = useState<{ concrete: DrawingLine[]; building: DrawingLine[]; audits: DrawingAudit[] }>({ concrete: [], building: [], audits: [] });
  const [savingDrawing, setSavingDrawing] = useState(false);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // Load project info and estimates
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {navigate("/auth");return;}
      setUserId(session.user.id);

      if (!projectId) return;

      const { data: project } = await supabase.
      from("projects").
      select("name").
      eq("id", projectId).
      single();

      if (project) setProjectName(project.name);

      const { data: estimates, error } = await supabase.
      from("estimates").
      select("*").
      eq("project_id", projectId).
      eq("discipline", "concrete").
      order("created_at", { ascending: true });

      // Package options must cover every discipline (building/mechanical lines
      // live outside `items`), otherwise their packages can't be selected.
      const { data: pkgRows } = await supabase.from("estimates").select("package").eq("project_id", projectId);
      if (pkgRows) setDbPackages([...new Set(pkgRows.map((r: any) => r.package).filter(Boolean))].sort() as string[]);

      if (!error && estimates) {
        setItems(estimates.map((e: any) => ({
          id: e.id,
          category: e.category as ConcreteCategory,
          description: e.description,
          quantity: e.quantity,
          length: Number(e.length),
          width: Number(e.width),
          thickness: Number(e.thickness),
          height: Number(e.height),
          area: Number(e.area || 0),
          unit: e.unit as "m" | "ft",
          notes: "",
          package: e.package || ""
        })));
      }
      setLoading(false);
    };
    init();
  }, [projectId, navigate]);

  const saveEstimate = async (item: ConcreteItem) => {
    if (!projectId || !userId) return false;
    const { error } = await supabase.from("estimates").upsert({
      id: item.id,
      project_id: projectId,
      user_id: userId,
      discipline: "concrete",
      category: item.category,
      description: item.description,
      quantity: item.quantity,
      length: item.length,
      width: item.width,
      thickness: item.thickness,
      height: item.height,
      area: item.area,
      unit: item.unit,
      package: item.package
    } as any);
    if (error) {
      toast({ title: "Estimate not saved", description: error.message, variant: "destructive" });
      return false;
    } else {
      setBuildingRefreshKey((key) => key + 1);
      return true;
    }
  };

  const addItemsFromAI = async (aiItems: any[]) => {
    const fallbackPackage = activePackage === "all" ? "" : activePackage;
    const newItems: ConcreteItem[] = aiItems.map((ai) => ({
      id: crypto.randomUUID(),
      category: ai.category || "slab",
      description: ai.note ? `${ai.description || ""} — ${ai.note}` : ai.description || "",
      quantity: ai.quantity || 1,
      length: ai.length || 0,
      width: ai.width || 0,
      thickness: ai.thickness || ai.height || 0,
      height: ai.height || ai.thickness || 0,
      area: ai.area || 0,
      unit: ai.unit || "m",
      notes: ai.note || "",
      package: ai.package || fallbackPackage
    }));
    const savedItems: ConcreteItem[] = [];
    for (const item of newItems) {
      if (await saveEstimate(item)) savedItems.push(item);
    }
    setItems((prev) => [...prev, ...savedItems]);
    if (savedItems.length !== newItems.length) return false;
    if (newItems.length > 0) setActiveCategory(newItems[0].category);
    
    // If AI detected a package, auto-switch to it
    const detectedPackage = aiItems.find((ai) => ai.package)?.package;
    if (detectedPackage) {
      setActivePackage(detectedPackage);
      toast({ title: `${newItems.length} item${newItems.length > 1 ? "s" : ""} added`, description: `Auto-assigned to package "${detectedPackage}".` });
    } else {
      toast({ title: `${newItems.length} item${newItems.length > 1 ? "s" : ""} added`, description: "Saved to project." });
    }
    return true;
  };

  const BUILDING_TRADES: BuildingTrade[] = ["civil", "general_conditions", "demolition", "parging", "flashings_trims", "siding_insulation", "windows", "doors", "attic_insulation", "ventilation", "electrical", "mechanical", "eaves_downspouts", "roofing", "painting", "landscaping_repair", "other"];

  const addBuildingItemsFromAI = async (aiItems: any[]) => {
    if (!projectId || !userId || !aiItems?.length) return false;
    const fallbackPackage = activePackage === "all" ? "" : activePackage;
    const rows = aiItems.map((ai) => {
      const item: BuildingItem = {
        id: crypto.randomUUID(),
        trade: (BUILDING_TRADES.includes(ai.trade) ? ai.trade : "other") as BuildingTrade,
        description: ai.note ? `${ai.description || ""} — ${ai.note}` : ai.description || "",
        quantity: Number(ai.quantity) || 1,
        length: Number(ai.length) || 0,
        width: Number(ai.width) || 0,
        uom: (["m2", "m3", "t", "m", "ea", "unit", "ls"].includes(ai.uom) ? ai.uom : "ea") as Uom,
        notes: ai.note || "",
        package: ai.package || fallbackPackage
      };
      return {
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
        package: item.package
      };
    });

    const { error } = await supabase.from("estimates").insert(rows as any);
    if (error) {
      console.error("Building save error:", error);
      toast({ title: "Couldn't save building items", description: error.message, variant: "destructive" });
      return false;
    }
    setActiveDiscipline("building");
    setBuildingRefreshKey((k) => k + 1);
    toast({ title: `${rows.length} building item${rows.length > 1 ? "s" : ""} added`, description: "Saved to Building Works." });
    return true;
  };

  const handleToolCalls = async (toolCalls: any[]) => {
    for (const tc of toolCalls || []) {
      const name = tc.function?.name;
      if (!name) continue;
      try {
        const args = JSON.parse(tc.function.arguments || "{}");
        if (!args.items?.length) continue;
        if (name === "add_items") await addItemsFromAI(args.items);
        else if (name === "add_building_items") await addBuildingItemsFromAI(args.items);
      } catch (e) {
        console.error("Failed to parse tool call", e);
      }
    }
  };

  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg: ChatMessage = { role: "user", content: chatInput.trim() };
    const updatedMessages = [...chatMessages, userMsg];
    setChatMessages(updatedMessages);
    setChatInput("");
    setChatLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("estimating-chat", {
        body: { messages: updatedMessages }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const choice = data.choices?.[0];
      const message = choice?.message;

      if (message?.tool_calls?.length) {
        await handleToolCalls(message.tool_calls);

        const toolResultMessages = [
        ...updatedMessages,
        { role: "assistant", content: message.content || "", tool_calls: message.tool_calls },
        ...message.tool_calls.map((tc: any) => ({
          role: "tool", tool_call_id: tc.id, content: JSON.stringify({ success: true })
        }))];

        const { data: followUp, error: followUpError } = await supabase.functions.invoke("estimating-chat", {
          body: { messages: toolResultMessages }
        });
        if (!followUpError && followUp?.choices?.[0]?.message?.content) {
          setChatMessages([...updatedMessages, { role: "assistant", content: followUp.choices[0].message.content }]);
        } else if (message.content) {
          setChatMessages([...updatedMessages, { role: "assistant", content: message.content }]);
        }
      } else if (message?.content) {
        setChatMessages([...updatedMessages, { role: "assistant", content: message.content }]);
      }
    } catch (e: any) {
      console.error("Chat error:", e);
      toast({ title: "Chat error", description: e.message || "Something went wrong", variant: "destructive" });
    } finally {
      setChatLoading(false);
      inputRef.current?.focus();
    }
  };

  const cleanupSilenceDetection = useCallback(() => {
    if (silenceCheckRef.current) {
      cancelAnimationFrame(silenceCheckRef.current);
      silenceCheckRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      // Set up silence detection
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (audioCtx.state === "suspended") await audioCtx.resume();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let isSpeaking = false;

      const checkSilence = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        const normalized = Math.min(avg / 60, 1);
        setAudioLevel(normalized);

        if (avg > SILENCE_THRESHOLD) {
          // User is speaking
          isSpeaking = true;
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        } else if (isSpeaking && !silenceTimerRef.current) {
          // User stopped speaking — start silence countdown
          silenceTimerRef.current = setTimeout(() => {
            // Auto-stop after silence
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
              mediaRecorderRef.current.stop();
              setIsRecording(false);
              cleanupSilenceDetection();
              audioCtx.close();
            }
          }, SILENCE_TIMEOUT);
        }

        silenceCheckRef.current = requestAnimationFrame(checkSilence);
      };

      mediaRecorder.ondataavailable = (e) => {if (e.data.size > 0) audioChunksRef.current.push(e.data);};
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        cleanupSilenceDetection();
        try {audioCtx.close();} catch {}
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(",")[1];
          setChatLoading(true);
          try {
            const { data, error } = await supabase.functions.invoke("transcribe-audio", { body: { audio: base64 } });
            if (error) throw error;
            if (data?.text) {
              const userMsg: ChatMessage = { role: "user", content: data.text };
              const updatedMessages = [...chatMessages, userMsg];
              setChatMessages(updatedMessages);
              setChatInput("");
              const { data: aiData, error: aiError } = await supabase.functions.invoke("estimating-chat", { body: { messages: updatedMessages } });
              if (aiError) throw aiError;
              if (aiData?.error) throw new Error(aiData.error);
              const choice = aiData.choices?.[0];
              const message = choice?.message;
              if (message?.tool_calls?.length) {
                await handleToolCalls(message.tool_calls);

                const toolResultMessages = [
                ...updatedMessages,
                { role: "assistant", content: message.content || "", tool_calls: message.tool_calls },
                ...message.tool_calls.map((tc: any) => ({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ success: true }) }))];

                const { data: followUp } = await supabase.functions.invoke("estimating-chat", { body: { messages: toolResultMessages } });
                if (followUp?.choices?.[0]?.message?.content) {
                  setChatMessages([...updatedMessages, { role: "assistant", content: followUp.choices[0].message.content }]);
                } else if (message.content) {
                  setChatMessages([...updatedMessages, { role: "assistant", content: message.content }]);
                }
              } else if (message?.content) {
                setChatMessages([...updatedMessages, { role: "assistant", content: message.content }]);
              }
            }
          } catch (e: any) {
            toast({ title: "Voice error", description: e.message || "Failed to transcribe", variant: "destructive" });
          } finally {setChatLoading(false);}
        };
        reader.readAsDataURL(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
      silenceCheckRef.current = requestAnimationFrame(checkSilence);
    } catch (e) {
      toast({ title: "Microphone error", description: "Could not access microphone", variant: "destructive" });
    }
  }, [chatMessages, cleanupSilenceDetection]);

  const stopRecording = useCallback(() => {
    cleanupSilenceDetection();
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, [isRecording, cleanupSilenceDetection]);

  const addItem = () => {
    const newItem: ConcreteItem = {
      id: crypto.randomUUID(),
      category: activeCategory,
      description: "",
      quantity: 1,
      length: 0, width: 0, thickness: 0, height: 0, area: 0,
      unit: "m",
      notes: "",
      package: activePackage === "all" ? "" : activePackage
    };
    setItems((prev) => [...prev, newItem]);
    saveEstimate(newItem);
  };

  const updateItem = (id: string, updates: Partial<ConcreteItem>) => {
    setItems((prev) => {
      const updated = prev.map((i) => {
        if (i.id !== id) return i;
        const merged = { ...i, ...updates };
        // Auto-clear note when dimensions are filled in
        if (i.notes && calcVolume(merged) > 0) {
          merged.notes = "";
        }
        return merged;
      });
      const item = updated.find((i) => i.id === id);
      if (item) saveEstimate(item);
      return updated;
    });
  };

  const deleteItem = async (id: string) => {
    const { error } = await supabase.from("estimates").delete().eq("id", id);
    if (error) {
      toast({ title: "Estimate not deleted", description: error.message, variant: "destructive" });
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
    setBuildingRefreshKey(key => key + 1);
  };

  type TakeoffResult = ReturnType<typeof readDrawingTakeoff>;

  const analyzeSingleFile = async (fileData: Blob, fileName: string, mimeType: string, prepared = false, collect?: (r: TakeoffResult) => void): Promise<number> => {
    if (exceedsDrawingFileLimit(fileData.size)) {
      toast({ title: `${fileName} too large`, description: `Max ${MAX_DRAWING_FILE_MB} MB per file. Skipping.`, variant: "destructive" });
      return 0;
    }
    const validTypes = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
    if (!validTypes.includes(mimeType)) return 0;

    if (mimeType === "application/pdf" && !prepared) {
      setAnalyzeProgress(`Preparing large PDF: ${fileName}...`);
      const parts = await prepareDrawingFiles(new File([fileData], fileName, { type: mimeType }));
      if (parts.length === 1) return analyzeSingleFile(parts[0], parts[0].name, parts[0].type, true, collect);
      // Each part is analyzed independently, so reconcile the combined scope here:
      // identical lines repeated across parts are counted once and their evidence merged.
      const collected: TakeoffResult[] = [];
      for (const part of parts) await analyzeSingleFile(part, part.name, part.type, true, r => collected.push(r));
      const concrete = reconcileDrawingParts(collected.map(r => ({ source: fileName, lines: r.concrete })));
      const building = reconcileDrawingParts(collected.map(r => ({ source: fileName, lines: r.building })));
      const merged: TakeoffResult = {
        concrete: concrete.lines,
        building: building.lines,
        audits: [...collected.flatMap(r => r.audits), { uncertainties: [
          MULTIPART_REVIEW_UNCERTAINTY,
          ...reconcileUncertainties({
            duplicatesRemoved: concrete.duplicatesRemoved + building.duplicatesRemoved,
            untaggedMerges: concrete.untaggedMerges + building.untaggedMerges,
            quantityConflicts: concrete.quantityConflicts + building.quantityConflicts,
          }),
        ] }],
        count: concrete.lines.length + building.lines.length,
      };
      if (collect) collect(merged); else publishTakeoff(fileName, merged);
      return merged.count;
    }

    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(fileData);
    });

    const { data, error } = await supabase.functions.invoke("analyze-drawing", {
      body: { image: base64, mimeType, fileName }
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    const message = data.choices?.[0]?.message;
    const result = readDrawingTakeoff(message);
    if (collect) {
      collect(result);
      return result.count;
    }
    publishTakeoff(fileName, result, message?.content || "");
    return result.count;
  };

  const publishTakeoff = (fileName: string, result: TakeoffResult, commentary = "") => {
    setDrawingDraft((prev) => ({
      concrete: [...prev.concrete, ...withDrawingIds(result.concrete)],
      building: [...prev.building, ...withDrawingIds(result.building)],
      audits: [...prev.audits, ...result.audits],
    }));
    if (result.building.length > 0) setActiveDiscipline("building");
    setChatMessages((prev) => [...prev, { role: "assistant", content:
      `${fileName}: ${result.count} proposed items (${result.concrete.length} concrete, ${result.building.length} building / mechanical). ${commentary}`
    }]);
  };

  const analyzeDrawing = async (file: File) => {
    if (!file) return;
    file = normalizeDrawingFile(file);

    setIsAnalyzing(true);
    setChatOpen(true);

    try {
      if (file.type === "application/zip" || file.type === "application/x-zip-compressed" || file.name.endsWith(".zip")) {
        setAnalyzeProgress("Extracting zip file...");
        const zip = await JSZip.loadAsync(file);
        const drawingFiles: {name: string;blob: Blob;mimeType: string;}[] = [];

        const mimeMap: Record<string, string> = {
          png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
          webp: "image/webp", pdf: "application/pdf"
        };

        for (const [path, entry] of Object.entries(zip.files)) {
          if (entry.dir || path.startsWith("__MACOSX") || path.startsWith(".")) continue;
          const ext = path.split(".").pop()?.toLowerCase() || "";
          const mime = mimeMap[ext];
          if (!mime) continue;
          const blob = await entry.async("blob");
          drawingFiles.push({ name: path.split("/").pop() || path, blob, mimeType: mime });
        }

        if (drawingFiles.length === 0) {
          toast({ title: "No drawings found", description: "Zip didn't contain any PNG, JPG, WebP, or PDF files.", variant: "destructive" });
          return;
        }

        setChatMessages((prev) => [...prev, { role: "assistant", content: `📁 Found ${drawingFiles.length} drawing${drawingFiles.length > 1 ? "s" : ""} in zip. Analyzing each...` }]);

        let totalItems = 0;
        for (let i = 0; i < drawingFiles.length; i++) {
          const df = drawingFiles[i];
          setAnalyzeProgress(`Analyzing ${i + 1}/${drawingFiles.length}: ${df.name}...`);
          try {
            totalItems += await analyzeSingleFile(df.blob, df.name, df.mimeType);
          } catch (e: any) {
            setChatMessages((prev) => [...prev, { role: "assistant", content: `⚠️ ${df.name}: ${e.message || "Analysis failed"}` }]);
          }
        }

        if (totalItems > 0) {
          setChatMessages((prev) => [...prev, { role: "assistant", content: `✅ Zip complete! ${totalItems} total proposed takeoff items ready for review from ${drawingFiles.length} drawings.` }]);
        }
      } else {
        setAnalyzeProgress("Reading drawing...");
        const validTypes = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
        if (!validTypes.includes(file.type)) {
          toast({ title: "Unsupported format", description: "Upload PNG, JPG, WebP, PDF, or ZIP.", variant: "destructive" });
          return;
        }
        setAnalyzeProgress("VoxPlan is reading all drawing disciplines...");
        const count = await analyzeSingleFile(file, file.name, file.type);
        if (count === 0) {
          toast({ title: "Drawing needs clarification", description: "No supported quantities were extracted. Check the drawing notes and missing evidence before retrying.", variant: "destructive" });
        }
      }
    } catch (e: any) {
      console.error("Drawing analysis error:", e);
      setDrawingDraft(prev => ({ ...prev, audits: [...prev.audits, { uncertainties: [`${file.name}: analysis did not complete. Do not treat the retained lines as full scope.`] }] }));
      toast({ title: "Analysis failed", description: e.message || "Could not analyze drawing", variant: "destructive" });
    } finally {
      setIsAnalyzing(false);
      setAnalyzeProgress("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Derive unique packages
  const allPackages = Array.from(new Set([...dbPackages, ...items.map((i) => i.package).filter(Boolean)])).sort();

  const filteredItems = activePackage === "all" ? items : items.filter((i) => i.package === activePackage);
  const categoryItems = filteredItems.filter((i) => i.category === activeCategory);
  const categoryTotal = categoryItems.reduce((sum, i) => sum + calcVolume(i), 0);
  const grandTotal = filteredItems.reduce((sum, i) => sum + calcVolume(i), 0);
  const orderTotal = grandTotal * (1 + wastePercent / 100);
  const dimensionLabel = activeCategory === "wall" ? "Height" : "Thickness";

  const CHART_COLORS = ["hsl(var(--primary))", "hsl(var(--accent))", "hsl(var(--destructive))"];
  const categoryVolumes = (["slab", "footing", "wall"] as ConcreteCategory[]).map((cat, i) => ({
    name: categoryLabels[cat],
    value: parseFloat(filteredItems.filter((item) => item.category === cat).reduce((s, item) => s + calcVolume(item), 0).toFixed(2)),
    fill: CHART_COLORS[i]
  }));
  const chartConfig = {
    slab: { label: "Slabs", color: CHART_COLORS[0] },
    footing: { label: "Footings", color: CHART_COLORS[1] },
    wall: { label: "Walls", color: CHART_COLORS[2] }
  };
  const totalItems = filteredItems.length;
  const largestItem = filteredItems.length > 0 ? filteredItems.reduce((max, i) => calcVolume(i) > calcVolume(max) ? i : max, filteredItems[0]) : null;
  const avgVolume = totalItems > 0 ? grandTotal / totalItems : 0;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <Calculator className="h-12 w-12 animate-pulse text-primary" />
      </div>);

  }
  const exportToExcel = () => {
    const wb = XLSX.utils.book_new();
    const categories: ConcreteCategory[] = ["slab", "footing", "wall"];
    const exportItems = activePackage === "all" ? items : items.filter((i) => i.package === activePackage);

    // All items sheet
    const allData = exportItems.map((item) => ({
      Package: item.package || "(none)",
      Category: categoryLabels[item.category],
      Description: item.description,
      Qty: item.quantity,
      "Area (m²)": item.area ? concreteAreaM2(item) : "",
      Length: item.length || "",
      Width: item.width || "",
      Thickness: item.thickness || "",
      Height: item.height || "",
      Unit: item.unit,
      "Volume (m³)": parseFloat(calcVolume(item).toFixed(4)),
      "Volume (CY)": parseFloat(cubicMetresToYards(calcVolume(item)).toFixed(4))
    }));
    const ws = XLSX.utils.json_to_sheet(allData);
    XLSX.utils.book_append_sheet(wb, ws, "All Items");

    // Per-category sheets
    for (const cat of categories) {
      const catItems = exportItems.filter((i) => i.category === cat);
      if (catItems.length === 0) continue;
      const catData = catItems.map((item) => ({
        Package: item.package || "(none)",
        Description: item.description,
        Qty: item.quantity,
        "Area (m²)": item.area ? concreteAreaM2(item) : "",
        Length: item.length || "",
        Width: item.width || "",
        Thickness: item.thickness || "",
        ...(cat === "wall" ? { Height: item.height || "" } : {}),
        Unit: item.unit,
        "Volume (m³)": parseFloat(calcVolume(item).toFixed(4)),
        "Volume (CY)": parseFloat(cubicMetresToYards(calcVolume(item)).toFixed(4))
      }));
      const subtotal = catItems.reduce((s, i) => s + calcVolume(i), 0);
      catData.push({
        Package: "",
        Description: "SUBTOTAL",
        Qty: catItems.reduce((s, i) => s + i.quantity, 0),
        "Area (m²)": "" as any,
        Length: "" as any,
        Width: "" as any,
        Thickness: "" as any,
        ...(cat === "wall" ? { Height: "" as any } : {}),
        Unit: "" as any,
        "Volume (m³)": parseFloat(subtotal.toFixed(4)),
        "Volume (CY)": parseFloat(cubicMetresToYards(subtotal).toFixed(4))
      });
      const catWs = XLSX.utils.json_to_sheet(catData);
      XLSX.utils.book_append_sheet(wb, catWs, categoryLabels[cat]);
    }

    // Summary sheet
    const summaryData = categories.map((cat) => {
      const catVol = exportItems.filter((i) => i.category === cat).reduce((s, i) => s + calcVolume(i), 0);
      return { Category: categoryLabels[cat], Items: exportItems.filter((i) => i.category === cat).length, "Net Volume (m³)": parseFloat(catVol.toFixed(4)), "Net Volume (CY)": parseFloat(cubicMetresToYards(catVol).toFixed(4)) };
    });
    const gt = exportItems.reduce((s, i) => s + calcVolume(i), 0);
    const ot = gt * (1 + wastePercent / 100);
    summaryData.push({ Category: "GRAND TOTAL (Net)", Items: exportItems.length, "Net Volume (m³)": parseFloat(gt.toFixed(4)), "Net Volume (CY)": parseFloat(cubicMetresToYards(gt).toFixed(4)) });
    summaryData.push({ Category: `ORDER TOTAL (+${wastePercent}% waste)`, Items: exportItems.length, "Net Volume (m³)": parseFloat(ot.toFixed(4)), "Net Volume (CY)": parseFloat(cubicMetresToYards(ot).toFixed(4)) });
    const summaryWs = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");

    const filename = `${projectName || "Estimate"}_${activePackage !== "all" ? activePackage + "_" : ""}${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, filename);
    toast({ title: "Exported", description: `Saved as ${filename}` });
  };

  return (
    <div className="min-w-0 flex-1 bg-background relative pb-28">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf,.zip"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) analyzeDrawing(file);
                  }} />
      <header className="border-b border-border bg-steel-dark px-4 sm:px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="icon" className="text-white/70 hover:text-white hover:bg-white/10" onClick={() => navigate("/estimating")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="bg-construction-orange text-primary-foreground p-2 rounded-lg">
              <Calculator className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-white break-words">{projectName || "Project Estimate"}</h1>
              <p className="text-sm text-white/70">Quantity takeoff — concrete &amp; building works</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={exportToExcel}
              variant="outline"
              className="gap-2 border-white/20 text-white bg-primary"
              disabled={items.length === 0}>
              
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Export Excel</span>
              <span className="sm:hidden">Export</span>
            </Button>
            <ProposalExport
              projectName={projectName}
              items={items}
              activePackage={activePackage}
              wastePercent={wastePercent}
            />
          </div>
        </div>
      </header>

      <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
        {/* Package Filter */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-muted-foreground">Package:</span>
          <Select value={activePackage} onValueChange={setActivePackage}>
            <SelectTrigger className="h-9 w-[200px]">
              <SelectValue placeholder="All Packages" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Packages</SelectItem>
              {allPackages.map((pkg) =>
              <SelectItem key={pkg} value={pkg}>{pkg}</SelectItem>
              )}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5">
            <Input
              placeholder="New package name..."
              value={newPackageName}
              onChange={(e) => setNewPackageName(e.target.value)}
              className="h-9 w-[180px] text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newPackageName.trim()) {
                  setActivePackage(newPackageName.trim());
                  setNewPackageName("");
                  toast({ title: "Package created", description: `"${newPackageName.trim()}" is now active.` });
                }
              }} />
            
            <Button
              size="sm"
              variant="outline"
              disabled={!newPackageName.trim()}
              onClick={() => {
                if (newPackageName.trim()) {
                  setActivePackage(newPackageName.trim());
                  setNewPackageName("");
                  toast({ title: "Package created", description: `"${newPackageName.trim()}" is now active.` });
                }
              }}>
              
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {activePackage !== "all" &&
          <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
              Filtering: <strong>{activePackage}</strong>
            </span>
          }
        </div>

        {(drawingDraft.concrete.length + drawingDraft.building.length > 0 || drawingDraft.audits.length > 0) && <section className="space-y-3 border-y border-border py-4">
          <h2 className="font-semibold">Drawing takeoff review</h2>
          {drawingDraft.audits.map((audit, index) => <div key={index} className="text-sm space-y-1">
            <p className="text-muted-foreground">Sheets: {audit.sheetsRead?.join("; ")}</p>
            {audit.uncertainties?.map((note, i) => <p key={i} className="text-destructive">Unconfirmed: {note}</p>)}
            {audit.exclusions?.map((note, i) => <p key={i} className="text-muted-foreground">Excluded: {note}</p>)}
          </div>)}
          {(["concrete", "building"] as const).flatMap((discipline) => drawingDraft[discipline].map((item, index) => <div key={`${discipline}-${index}`} className="flex items-start gap-3 border-b border-border py-2">
            <div className="flex-1 min-w-0 text-sm"><p className="font-medium break-words">{item.description}</p><p>{discipline === "concrete" ? item.category : item.trade} · {item.quantity} {item.uom || item.unit}{item.length ? ` · length ${item.length}` : ""}</p><p className="text-muted-foreground break-words">{item.note}</p></div>
            <Button variant="ghost" size="icon" aria-label={`Remove ${discipline} proposed item ${index + 1}`} disabled={savingDrawing} onClick={() => setDrawingDraft((prev) => ({ ...prev, [discipline]: prev[discipline].filter((_, i) => i !== index) }))}><Trash2 className="h-4 w-4" /></Button>
          </div>))}
          <div className="flex flex-wrap gap-2">
            <Button disabled={savingDrawing || isAnalyzing || drawingDraft.concrete.length + drawingDraft.building.length === 0} onClick={async () => {
              setSavingDrawing(true);
              try {
                if (!projectId || !userId) throw new Error("Sign in before saving this review.");
                const fallbackPackage = activePackage === "all" ? "" : activePackage;
                const rows = (["concrete", "building"] as const).flatMap(discipline => drawingDraft[discipline].map(line => {
                  const building = discipline === "building";
                  const qtyItem = { quantity: Number(line.quantity) || 1, length: Number(line.length) || 0, width: Number(line.width) || 0, uom: (line.uom || "ea") as Uom };
                  return { id: line.id, project_id: projectId, user_id: userId, discipline, category: building ? "building" : line.category || "slab", trade: building ? line.trade || "other" : "", description: line.note ? `${line.description} — ${line.note}` : line.description, ...qtyItem, thickness: Number(line.thickness || line.height) || 0, height: Number(line.height || line.thickness) || 0, area: Number(line.area) || 0, unit: line.unit || "m", unit_qty: building ? calcBuildingQty(qtyItem as BuildingItem) : 0, package: line.package || fallbackPackage };
                }));
                await approveDrawingRows(rows, async saved => supabase.from("estimates").upsert(saved as any, { onConflict: "id" }), () => {
                  const concreteItems: ConcreteItem[] = drawingDraft.concrete.map(line => ({ id: line.id, category: line.category || "slab", description: line.note ? `${line.description} — ${line.note}` : line.description, quantity: Number(line.quantity) || 1, length: Number(line.length) || 0, width: Number(line.width) || 0, thickness: Number(line.thickness || line.height) || 0, height: Number(line.height || line.thickness) || 0, area: Number(line.area) || 0, unit: line.unit || "m", notes: line.note || "", package: line.package || fallbackPackage }));
                  setItems(prev => [...prev.filter(item => !concreteItems.some(saved => saved.id === item.id)), ...concreteItems]);
                  setBuildingRefreshKey(key => key + 1);
                  setDrawingDraft({ concrete: [], building: [], audits: [] });
                });
              } catch (error) {
                toast({ title: "Drawing not saved", description: error instanceof Error ? error.message : "Save failed. Your review is retained for retry.", variant: "destructive" });
              } finally { setSavingDrawing(false); }
            }}>Save {drawingDraft.concrete.length + drawingDraft.building.length} reviewed items</Button>
            <Button variant="outline" disabled={savingDrawing || isAnalyzing} onClick={() => setDrawingDraft({ concrete: [], building: [], audits: [] })}>Discard</Button>
          </div>
        </section>}

        <Tabs value={activeDiscipline} onValueChange={setActiveDiscipline} className="space-y-6">
          <TabsList className="grid h-auto w-full grid-cols-1 sm:inline-flex sm:w-auto">
            <TabsTrigger value="concrete" className="gap-2"><Calculator className="h-4 w-4" /> Concrete</TabsTrigger>
            <TabsTrigger value="building" className="gap-2"><Building2 className="h-4 w-4" /> Building & Mechanical</TabsTrigger>
            <TabsTrigger value="costs" className="gap-2"><DollarSign className="h-4 w-4" /> Costs</TabsTrigger>
          </TabsList>

          <TabsContent value="concrete" className="space-y-6 mt-0">

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {(["slab", "footing", "wall"] as ConcreteCategory[]).map((cat) => {
            const catItems = filteredItems.filter((i) => i.category === cat);
            const catVol = catItems.reduce((s, i) => s + calcVolume(i), 0);
            return (
              <Card key={cat} className={`cursor-pointer transition-all ${activeCategory === cat ? "ring-2 ring-primary" : "hover:border-primary/40"}`} onClick={() => setActiveCategory(cat)}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{categoryLabels[cat]}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{catItems.length}</p>
                  <p className="text-xs text-muted-foreground">{catVol.toFixed(2)} m³</p>
                </CardContent>
              </Card>);

          })}
          <Card className="bg-steel-dark text-white">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-white/70">Grand Total</CardTitle>
                <Select value={String(wastePercent)} onValueChange={(v) => setWastePercent(Number(v))}>
                  <SelectTrigger className="h-7 w-[80px] text-xs bg-white/10 border-white/20 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">0% waste</SelectItem>
                    <SelectItem value="5">5% waste</SelectItem>
                    <SelectItem value="7">7% waste</SelectItem>
                    <SelectItem value="10">10% waste</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-lg font-medium text-white/70">Net: {grandTotal.toFixed(2)} m³ <span className="text-xs">({cubicMetresToYards(grandTotal).toFixed(2)} CY)</span></p>
              <p className="text-2xl font-bold">Order: {orderTotal.toFixed(2)} m³ <span className="text-sm font-normal text-white/70">({cubicMetresToYards(orderTotal).toFixed(2)} CY)</span></p>
            </CardContent>
          </Card>
        </div>

        {/* Metrics & Charts */}
        {items.length > 0 &&
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" /> Quick Stats
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1"><span className="text-muted-foreground">Total Items</span><span className="font-semibold">{totalItems}</span></div>
                  <div className="flex justify-between text-sm mb-1"><span className="text-muted-foreground">Avg Volume</span><span className="font-semibold">{avgVolume.toFixed(2)} m³</span></div>
                  {largestItem && <div className="flex justify-between text-sm mb-1"><span className="text-muted-foreground">Largest Item</span><span className="font-semibold">{calcVolume(largestItem).toFixed(2)} m³</span></div>}
                </div>
                <div className="space-y-2">
                  {(["slab", "footing", "wall"] as ConcreteCategory[]).map((cat) => {
                  const catVol = items.filter((item) => item.category === cat).reduce((s, item) => s + calcVolume(item), 0);
                  const pct = grandTotal > 0 ? catVol / grandTotal * 100 : 0;
                  return (
                    <div key={cat}>
                        <div className="flex justify-between text-xs mb-1"><span className="text-muted-foreground">{categoryLabels[cat]}</span><span>{pct.toFixed(0)}%</span></div>
                        <Progress value={pct} className="h-2" />
                      </div>);

                })}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <PieChart className="h-4 w-4 text-muted-foreground" /> Volume Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="aspect-square max-h-[200px] mx-auto">
                  <RePieChart>
                    <Pie data={categoryVolumes.filter((d) => d.value > 0)} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={70} strokeWidth={2}>
                      {categoryVolumes.filter((d) => d.value > 0).map((entry, idx) => <Cell key={idx} fill={entry.fill} />)}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent />} />
                  </RePieChart>
                </ChartContainer>
                <div className="flex justify-center gap-4 mt-2">
                  {categoryVolumes.filter((d) => d.value > 0).map((d, i) =>
                <div key={i} className="flex items-center gap-1.5 text-xs">
                      <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.fill }} />
                      <span className="text-muted-foreground">{d.name}</span>
                    </div>
                )}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" /> Volume by Category (m³)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="aspect-[4/3] max-h-[220px]">
                  <BarChart data={categoryVolumes} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                    <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {categoryVolumes.map((entry, idx) => <Cell key={idx} fill={entry.fill} />)}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>
        }

        {/* Active Category Table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{categoryLabels[activeCategory]}</CardTitle>
              <div className="flex gap-2">
                {categoryItems.length > 0 &&
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10"
                  onClick={async () => {
                    const ids = categoryItems.map((i) => i.id);
                    setItems((prev) => prev.filter((i) => i.category !== activeCategory));
                    for (const id of ids) {
                      await supabase.from("estimates").delete().eq("id", id);
                    }
                    toast({ title: "Deleted", description: `All ${categoryLabels[activeCategory]} items removed.` });
                  }}>
                  
                    <Trash2 className="h-4 w-4 mr-1" /> Clear All
                  </Button>
                }
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isAnalyzing}
                  size="sm"
                  className="gap-2">
                  {isAnalyzing ?
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="hidden sm:inline">{analyzeProgress}</span>
                      <span className="sm:hidden">Analyzing...</span>
                    </> :
                    <>
                      <FileImage className="h-4 w-4" />
                      <span className="hidden sm:inline">Upload Drawing</span>
                      <span className="sm:hidden">Upload</span>
                    </>
                  }
                </Button>
                <Button onClick={addItem} size="sm"><Plus className="h-4 w-4 mr-1" /> Add Item</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {categoryItems.length === 0 ?
            <div className="text-center py-12 text-muted-foreground">
                <Calculator className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p>No items yet. Use the chat or click "Add Item".</p>
              </div> :

            <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                     <TableRow>
                       <TableHead className="w-28">Package</TableHead>
                        <TableHead className="min-w-[160px]">Description</TableHead>
                       <TableHead className="w-20">Qty</TableHead>
                       <TableHead className="w-24">Area (m² / ft²)</TableHead>
                       <TableHead className="w-24">Length</TableHead>
                       <TableHead className="w-24">Width</TableHead>
                       {activeCategory !== "wall" && <TableHead className="w-24">Thickness</TableHead>}
                       {activeCategory === "wall" && <TableHead className="w-24">Height</TableHead>}
                       <TableHead className="w-20">Unit</TableHead>
                       <TableHead className="w-28 text-right">Volume</TableHead>
                       <TableHead className="w-12" />
                     </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categoryItems.map((item) => {
                    const vol = calcVolume(item);
                    const usesArea = item.area > 0;
                    const hasNote = !!item.notes;
                    const isMissing = vol === 0;
                    const isEstimated = hasNote && !isMissing;
                    return (
                      <TableRow key={item.id} className={isMissing ? "bg-destructive/10" : isEstimated ? "bg-blue-500/5" : ""}>
                          <TableCell>
                            <Input
                            placeholder="e.g., Building A"
                            value={item.package}
                            onChange={(e) => updateItem(item.id, { package: e.target.value })}
                            className="h-8 w-24 text-xs" />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              {hasNote &&
                            <button
                              type="button"
                              className={`shrink-0 transition-colors ${isMissing ? "text-destructive hover:text-destructive/80" : "text-blue-500 hover:text-blue-400"}`}
                              title={item.notes}
                              onClick={() => toast({ title: isMissing ? "⚠️ Missing Dimensions" : "ℹ️ Estimated Dimensions", description: item.notes, duration: 8000 })}>
                              
                                  {isMissing ? <AlertTriangle className="h-4 w-4" /> : <Info className="h-4 w-4" />}
                                </button>
                            }
                              <Input placeholder={`e.g., ${activeCategory === "footing" ? "Strip Footing F1" : activeCategory === "wall" ? "Retaining Wall W1" : "Ground Floor Slab"}`} value={item.description} onChange={(e) => updateItem(item.id, { description: e.target.value })} className="h-8" />
                            </div>
                          </TableCell>
                          <TableCell><Input type="number" min={1} value={item.quantity} onChange={(e) => updateItem(item.id, { quantity: Number(e.target.value) || 1 })} className="h-8 w-16" /></TableCell>
                          <TableCell>
                            <Input type="number" step="0.01" min={0} value={item.area || ""} onChange={(e) => updateItem(item.id, { area: Number(e.target.value) || 0, length: 0, width: 0 })} placeholder="—" className={`h-8 w-20 ${usesArea ? "ring-1 ring-primary/30" : ""}`} />
                          </TableCell>
                          <TableCell>
                            <Input type="number" step="0.01" min={0} value={item.length || ""} onChange={(e) => updateItem(item.id, { length: Number(e.target.value) || 0, area: 0 })} className="h-8 w-20" disabled={usesArea} />
                          </TableCell>
                          <TableCell>
                            <Input type="number" step="0.01" min={0} value={item.width || ""} onChange={(e) => updateItem(item.id, { width: Number(e.target.value) || 0, area: 0 })} className="h-8 w-20" disabled={usesArea && activeCategory !== "wall"} />
                          </TableCell>
                          {activeCategory !== "wall" &&
                          <TableCell>
                            <Input type="number" step="0.01" min={0} value={item.thickness || ""} onChange={(e) => updateItem(item.id, { thickness: Number(e.target.value) || 0 })} className="h-8 w-20" />
                          </TableCell>
                          }
                          {activeCategory === "wall" &&
                          <TableCell>
                            <Input type="number" step="0.01" min={0} value={item.height || ""} onChange={(e) => updateItem(item.id, { height: Number(e.target.value) || 0 })} className="h-8 w-20" />
                          </TableCell>
                          }
                          <TableCell>
                            <Select value={item.unit} onValueChange={(v) => updateItem(item.id, { unit: v as "m" | "ft" })}>
                              <SelectTrigger className="h-8 w-16"><SelectValue /></SelectTrigger>
                              <SelectContent><SelectItem value="m">m</SelectItem><SelectItem value="ft">ft</SelectItem></SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            {isMissing ? <span className="text-destructive text-xs">TBD</span> :
                          isEstimated ? <span className="text-blue-500">{formatVol(vol, item.unit)}*</span> :
                          formatVol(vol, item.unit)}
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => deleteItem(item.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>);

                  })}
                     <TableRow className="bg-muted/50 font-semibold">
                       <TableCell colSpan={8} className="text-right">Subtotal ({categoryLabels[activeCategory]})</TableCell>
                       <TableCell className="text-right font-mono">{formatVol(categoryTotal, categoryItems[0]?.unit || "m")}</TableCell>
                       <TableCell />
                     </TableRow>
                  </TableBody>
                </Table>
              </div>
            }
          </CardContent>
        </Card>
        </TabsContent>

        <TabsContent value="building" className="space-y-6 mt-0">
          {projectId &&
          <BuildingTakeoff
            key={buildingRefreshKey}
            projectId={projectId}
            projectName={projectName}
            userId={userId}
            activePackage={activePackage} />

          }
        </TabsContent>

        <TabsContent value="costs" className="space-y-6 mt-0">
          {projectId &&
          <CostEstimate
            projectId={projectId}
            projectName={projectName}
            activePackage={activePackage}
            wastePercent={wastePercent}
            refreshKey={buildingRefreshKey} />

          }
        </TabsContent>
        </Tabs>
      </div>

      {/* Chat FAB */}
      {!chatOpen &&
      <Button onClick={() => {setChatOpen(true);setTimeout(() => inputRef.current?.focus(), 100);}} className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg bg-construction-orange hover:bg-construction-orange/90 z-50" size="icon">
          <MessageSquare className="h-6 w-6 text-white" />
        </Button>
      }

      {/* Chat Panel */}
      {chatOpen &&
      <div className="fixed bottom-6 right-6 w-[380px] max-w-[calc(100vw-2rem)] h-[500px] max-h-[calc(100vh-6rem)] bg-card border border-border rounded-xl shadow-2xl flex flex-col z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-steel-dark rounded-t-xl">
            <div className="flex items-center gap-2">
              <Calculator className="h-5 w-5 text-construction-orange" />
              <span className="font-semibold text-white text-sm">VoxPlan Estimator</span>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-white/70 hover:text-white hover:bg-white/10" onClick={() => setChatOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <ScrollArea className="flex-1 p-3">
            {chatMessages.length === 0 &&
          <div className="text-center text-muted-foreground text-sm py-8 px-4">
                <Calculator className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="font-medium mb-1">Concrete or full building works — just tell me the scope.</p>
                <p className="text-xs">Try: "4 footings, 2m x 1m x 0.5m" or "24 townhouse units — new siding, windows, doors, attic insulation"</p>

              </div>
          }
            {chatMessages.map((msg, i) =>
          <div key={i} className={`mb-3 flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
              className={`max-w-[85%] px-3 py-2 rounded-lg text-sm ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}
              dangerouslySetInnerHTML={{
                __html: msg.content.
                replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>').
                replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').
                replace(/\*(.*?)\*/g, '<em>$1</em>').
                replace(/\n/g, '<br />')
              }} />
            
              </div>
          )}
            {chatLoading &&
          <div className="flex justify-start mb-3">
                <div className="bg-muted px-3 py-2 rounded-lg text-sm text-muted-foreground"><span className="animate-pulse">Thinking...</span></div>
              </div>
          }
            <div ref={chatEndRef} />
          </ScrollArea>
          <div className="p-3 border-t border-border space-y-2">
            {isAnalyzing &&
          <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>{analyzeProgress}</span>
              </div>
          }
            <form onSubmit={(e) => {e.preventDefault();sendChat();}} className="flex gap-2">
              <div className="relative flex items-center justify-center">
                {isRecording &&
              <span
                className="absolute rounded-full border-2 border-primary pointer-events-none"
                style={{
                  width: `${36 + audioLevel * 20}px`,
                  height: `${36 + audioLevel * 20}px`,
                  opacity: 0.3 + audioLevel * 0.7,
                  transition: "all 0.1s ease-out"
                }} />

              }
                <Button type="button" size="icon" variant={isRecording ? "destructive" : "outline"} onClick={isRecording ? stopRecording : startRecording} disabled={chatLoading || isAnalyzing}>
                  {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </Button>
              </div>
              <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={chatLoading || isAnalyzing}
              title="Upload drawing">
              
                <FileImage className="h-4 w-4" />
              </Button>
              <Input ref={inputRef} value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder={isRecording ? "Listening..." : "Concrete or building scope — e.g. siding for 12 units"} className="flex-1 text-sm" disabled={chatLoading || isRecording || isAnalyzing} />
              <Button type="submit" size="icon" disabled={chatLoading || !chatInput.trim() || isAnalyzing} className="bg-construction-orange hover:bg-construction-orange/90">
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>
      }
      {projectId && <SpecsChat projectId={projectId} />}
    </div>);

};

export default ProjectEstimate;