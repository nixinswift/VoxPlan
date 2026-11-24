import { CIVIL_SCHEDULING_GUIDANCE } from "../_shared/civil-planning.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { MECHANICAL_SCHEDULING_GUIDANCE } from "../_shared/mechanical-planning.ts";
import { TECHNICAL_DRAWING_GUIDANCE } from "../_shared/technical-drawings.ts";
import { scheduleOverlaps as overlaps } from "../_shared/schedule-intervals.ts";
import { parseEquipment as normalizeEquipment, findingScore, concurrentAt } from "../_shared/resource-equipment.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const TRADES = ["electrical","mechanical","plumbing","structural","finishes","general","asbestos_abatement","demolition","concrete_construction","concrete_pour","concrete_cutting","concrete_grinding","concrete_finishing","rebar","formwork","civil"];

interface Activity {
  name: string;
  trade: string;
  manpower: number;
  equipment: string;
  duration: number;
  startDate: string; // YYYY-MM-DD
  notes?: string;
}

interface Finding {
  type: "manpower" | "overlap" | "equipment" | "sequence" | "duration" | "missing" | "logic";
  severity: "high" | "medium" | "low";
  activity: string;
  issue: string;
  recommendation: string;
}

const day = 86400000;


/** Deterministic checks so real conflicts are never missed by the model. */
function deterministicFindings(activities: Activity[], equipmentFleet: Record<string, number>): Finding[] {
  const findings: Finding[] = [];

  for (const a of activities) {
    if (!a.startDate || Number.isNaN(new Date(a.startDate + "T00:00:00Z").getTime())) {
      findings.push({ type: "missing", severity: "high", activity: a.name, issue: "No valid start date could be read for this activity.", recommendation: "Assign a start date before this activity is used for planning." });
    }
    if (!a.manpower || a.manpower < 1) {
      findings.push({ type: "manpower", severity: "high", activity: a.name, issue: "No crew size assigned.", recommendation: "Assign a realistic crew size for this trade and scope." });
    }
    if (!a.duration || a.duration < 1) {
      findings.push({ type: "duration", severity: "high", activity: a.name, issue: "Duration is missing or zero.", recommendation: "Set a duration in working days based on quantity and crew productivity." });
    }
  }

  // Equipment double-booking
  const bookings = new Map<string, Activity[]>();
  for (const a of activities) {
    for (const e of normalizeEquipment(a.equipment)) {
      if (!bookings.has(e)) bookings.set(e, []);
      bookings.get(e)?.push(a);
    }
  }
  for (const [equip, list] of bookings) {
    const available = equipmentFleet[equip] ?? 1;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (overlaps(list[i], list[j])) {
          const instant = Math.max(Date.parse(list[i].startDate), Date.parse(list[j].startDate));
          const concurrent = concurrentAt(list, instant);
          if (concurrent > available) {
            findings.push({
              type: "equipment",
              severity: "high",
              activity: `${list[i].name} / ${list[j].name}`,
              issue: `${concurrent} activities need "${equip}" at the same time but only ${available} appear${available === 1 ? "s" : ""} to be available.`,
              recommendation: `Stagger these activities, or confirm a second ${equip} is on site for the overlap window.`,
            });
          }
        }
      }
    }
  }

  // Same-trade overlap (crew can't be in two places)
  for (let i = 0; i < activities.length; i++) {
    for (let j = i + 1; j < activities.length; j++) {
      const a = activities[i], b = activities[j];
      if (a.trade === b.trade && overlaps(a, b)) {
        findings.push({
          type: "overlap",
          severity: "medium",
          activity: `${a.name} / ${b.name}`,
          issue: `Two ${a.trade.replace(/_/g, " ")} activities overlap (combined ${a.manpower + b.manpower} workers from the same trade pool).`,
          recommendation: "Confirm the trade can staff both fronts simultaneously, or sequence them.",
        });
      }
    }
  }

  // De-dup
  const seen = new Set<string>();
  return findings.filter((f) => {
    const k = f.type + f.activity + f.issue;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      fileName,
      fileType,
      fileBase64,
      fileText,
      existingTasks = [],
      equipmentFleet = {},
      mode = "review",
      planningContext = "",
    } = await req.json() as {
      fileName?: string;
      fileType?: string;
      fileBase64?: string;
      fileText?: string;
      existingTasks?: { name: string; trade: string; manpower: number; equipment: string; duration: number; startDate: string }[];
      equipmentFleet?: Record<string, number>;
      mode?: "review" | "plan";
      planningContext?: string;
    };

    if (!fileBase64 && !fileText) {
      return new Response(JSON.stringify({ error: "Provide a file or pasted schedule text" }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const today = new Date().toISOString().slice(0, 10);

    const systemPrompt = `You are a senior construction scheduler and constructability reviewer performing a hard-nosed audit of an uploaded schedule.

${MECHANICAL_SCHEDULING_GUIDANCE}
${CIVIL_SCHEDULING_GUIDANCE}

${TECHNICAL_DRAWING_GUIDANCE}

REQUEST MODE: ${mode === "plan" ? "BUILD A PROPOSED SCHEDULE FROM DRAWINGS/SCOPE, not an extraction of an existing schedule" : "REVIEW EXISTING SCHEDULE"}.
For plan mode, inventory the drawing evidence first, derive work packages from confirmed quantities and explicit scope, then generate all needed installation, inspection/testing and turnover activities. Include document/sheet/revision, quantity basis, crew/craft assumptions, production rate arithmetic, dependency/release condition and any hold point in each activity's notes. Drawings alone cannot confirm manpower, durations or deliveries: label these proposed assumptions. Use planningContext for supplied start date, shift hours, crews, shutdown windows and equipment. Otherwise use a Monday-Friday preliminary calendar, start on the next working day, and flag unknown holidays/shift patterns. Honour explicit dates. Sequence by released system/area, overlap fabrication with site enabling work and independent systems where resources permit; no blanket serial mechanical phase. Keep inspections/testing before covered joints/insulation unless the approved procedure permits otherwise. A missing shutdown approval is a hold point, not invented permission.
If only a P&ID or incomplete drawing is present, produce a clearly provisional package plan and name missing isometrics/BOMs/productivity inputs; never pretend it is a fully measured execution schedule. Return drawingAudit with sheetsRead, uncertainties and exclusions arrays. For review mode preserve supplied dates and durations.

DATE SEMANTICS: Existing schedule review uses consecutive calendar days, with an exclusive finish = start + duration. A one-day activity on November 22, 2026 ends before work starting November 23: never report an overlap between those activities, even though November 22 is Sunday. Report an explicitly violated predecessor separately. In plan mode use working days to choose dates, but return duration as the calendar span for the daily schedule, documenting productive working days in notes.
Maintenance inspections and tests do not inherit construction installation phases: only enforce confirmed dependencies.

STEP 1 — EXTRACT every activity you can read: name, trade, crew size (manpower), equipment, duration in calendar days, start date (YYYY-MM-DD).
- Trade MUST be one of: ${TRADES.join(", ")}.
- If a value is genuinely absent, use an industry-standard estimate and record a finding of type "missing" saying you assumed it.
- If no dates exist at all, sequence the activities logically starting ${today}.

STEP 2 — FIND DEFICIENCIES. Be skeptical and specific, and name real numbers. Look hard for:
- UNDERMANNED work: crew size too small for the scope/duration ("3 workers won't pour and finish 180 m3 in 2 days — needs 6-8 plus a finisher crew").
- OVERLAP / stacking of trades in the same area, and same-trade crews double-booked.
- EQUIPMENT CONFLICTS: two activities needing the same JLG / lift / excavator / pump / crane at once when only one is on site. Say so explicitly and ask whether a second unit is available.
- SEQUENCE VIOLATIONS against: asbestos → demolition → civil → formwork → rebar → concrete pour → concrete finishing → structural → MEP rough-in (parallel) → finishes → general.
- MISSING SCOPE: inspections, hold points, concrete cure time, layout/survey, permits, safety/shoring, cleanup, punchlist, commissioning.
- UNREALISTIC DURATIONS, zero float, weekend/holiday assumptions, and unbuildable logic.

Every finding must be actionable and reference the affected activity by name. Do not return an empty findings list unless the schedule is genuinely clean; if it is clean, say what you verified in the summary.

Return STRICT JSON:
{
  "scheduleTitle": string,
  "activities": [{"name":string,"trade":string,"manpower":number,"equipment":string,"duration":number,"startDate":"YYYY-MM-DD","notes":string}],
  "drawingAudit": {"sheetsRead":[string],"uncertainties":[string],"exclusions":[string]},
  "findings": [{"type":"manpower"|"overlap"|"equipment"|"sequence"|"duration"|"missing"|"logic","severity":"high"|"medium"|"low","activity":string,"issue":string,"recommendation":string}],
  "overallScore": number,
  "summary": string
}`;

    const context = [
      existingTasks.length
        ? `EXISTING SCHEDULE ALREADY IN THE PROJECT (check the upload against it for equipment/manpower clashes):\n${existingTasks.map((t) => `- "${t.name}" (${t.trade}) ${t.duration}d, ${t.manpower} workers, equipment: ${t.equipment || "none"}, starts ${t.startDate}`).join("\n")}`
        : "",
      Object.keys(equipmentFleet).length
        ? `KNOWN EQUIPMENT ON SITE (unit counts): ${Object.entries(equipmentFleet).map(([k, v]) => `${k} x${v}`).join(", ")}`
        : "Assume only ONE unit of each named piece of equipment is on site unless the document says otherwise.",
    ].filter(Boolean).join("\n\n");

    const userContent: any[] = [
      { type: "text", text: `${mode === "plan" ? "Build a proposed schedule from these drawings / scope" : "Audit this uploaded schedule"}${fileName ? ` ("${fileName}")` : ""}.\n\n${context}\n\nPlanning context: ${String(planningContext).slice(0, 10000)}` },
    ];

    if (fileText) {
      userContent.push({ type: "text", text: `SCHEDULE CONTENT:\n${fileText.slice(0, 120000)}` });
    }
    if (fileBase64) {
      const mime = fileType || "application/pdf";
      if (mime === "application/pdf") {
        userContent.push({ type: "file", file: { filename: fileName || "schedule.pdf", file_data: `data:application/pdf;base64,${fileBase64}` } });
      } else if (mime.startsWith("image/")) {
        userContent.push({ type: "image_url", image_url: { url: `data:${mime};base64,${fileBase64}` } });
      } else {
        userContent.push({ type: "text", text: `(Unsupported binary type ${mime}; rely on any text provided above.)` });
      }
    }

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      if ([400, 401, 403, 404].includes(aiResponse.status)) {
        let message = "Drawing planning request could not be completed.";
        try { const err = JSON.parse(errText); message = err.message || err.error?.message || message; } catch { /* retain safe default */ }
        return new Response(JSON.stringify({ error: message }), { status: aiResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      console.error("AI gateway error:", aiResponse.status, errText);
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit reached. Try again in a moment." }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add credits to continue." }), { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      throw new Error(`AI gateway error ${aiResponse.status}`);
    }

    const data = await aiResponse.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("The AI returned no content for this document");

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("Could not read the schedule from this file");
      parsed = JSON.parse(match[0]);
    }

    const activities: Activity[] = (parsed.activities || []).map((a: any) => ({
      name: String(a.name || "Unnamed activity"),
      trade: TRADES.includes(a.trade) ? a.trade : "general",
      manpower: Number(a.manpower) || 0,
      equipment: typeof a.equipment === "string" ? a.equipment : "",
      duration: Number(a.duration) || 0,
      startDate: typeof a.startDate === "string" ? a.startDate.slice(0, 10) : today,
      notes: typeof a.notes === "string" ? a.notes : "",
    }));

    const aiFindings: Finding[] = (parsed.findings || []).filter((f: any) => {
      if (!f?.issue) return false;
      if (!["overlap", "equipment"].includes(f.type)) return true;
      const reference = `${f.activity || ""} ${f.issue}`.toLowerCase();
      const mentioned = activities.filter(a => reference.includes(a.name.toLowerCase()));
      // Keep resource findings only if the referenced activities really coincide.
      if (mentioned.length < 2) return true;
      return mentioned.some((a, i) => mentioned.slice(i + 1).some(b => overlaps(a, b)));
    });
    const findings = [...deterministicFindings(activities, Object.fromEntries(Object.entries(equipmentFleet).map(([k, v]) => [k.toLowerCase(), Number(v) || 1]))), ...aiFindings];

    const rank = { high: 0, medium: 1, low: 2 } as Record<string, number>;
    findings.sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3));

    return new Response(JSON.stringify({
      scheduleTitle: parsed.scheduleTitle || fileName || "Uploaded schedule",
      activities,
      drawingAudit: parsed.drawingAudit,
      findings,
      overallScore: findingScore(findings),
      summary: parsed.summary || `${activities.length} activities read, ${findings.length} deficiencies flagged.`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error("review-schedule-upload error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
