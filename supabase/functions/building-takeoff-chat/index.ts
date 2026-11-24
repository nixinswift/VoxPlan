import { CIVIL_ESTIMATING_GUIDANCE } from "../_shared/civil-planning.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { MECHANICAL_ESTIMATING_GUIDANCE } from "../_shared/mechanical-planning.ts";
import { TECHNICAL_DRAWING_GUIDANCE } from "../_shared/technical-drawings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TRADES = [
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

const SYSTEM_PROMPT = `You are VoxPlan Building Estimator — a full-building quantity takeoff assistant for construction professionals (not just concrete).

${MECHANICAL_ESTIMATING_GUIDANCE}
${CIVIL_ESTIMATING_GUIDANCE}

${TECHNICAL_DRAWING_GUIDANCE}
For drawing uploads, include a drawingAudit in add_building_items: sheetsRead, uncertainties and exclusions (string arrays). Each note MUST contain its source and measured/derived/provisional status. For industrial drawings this evidence policy takes precedence over the generic residential defaults below. Add only supported quantities; if nothing is quantifiable, explain the missing evidence without fabricating items.

You produce measured takeoff lines for BUILDING work: envelope upgrades, siding, insulation, windows, doors, flashings, parging, attic insulation, ventilation, electrical, eaves/downspouts, roofing, painting, demolition and general conditions.

TRADES (use exactly one of these ids): ${TRADES.join(", ")}

UNITS OF MEASURE (uom):
- "m2" — wall/siding/insulation/parging/sheathing/house wrap areas
- "m" — linear runs: flashings, battens, drip caps, eavestrough, downspouts, roof-to-wall flashing, fencing
- "ea" — countable items: windows, doors, doorbells, lights, GFCI receptacles, mailboxes, chase caps, unit-number plaques, vents, hose bibbs, attic hatches
- "unit" — per dwelling unit items (attic insulation per suite, unit-number plaques per suite)
- "ls" — lump sum / general conditions (fencing, bins, permits, temporary facilities, waste diversion tracking, protection of tenant belongings)

QUANTITY RULES:
1. For area lines you may give length + width (metres) and quantity — the app computes quantity x length x width.
2. For linear lines give length (metres) and quantity; leave width 0.
3. For count lines (ea/unit/ls) give quantity only; leave length and width 0.
4. Never return 0 for everything — estimate with the industry defaults below and add a "note" explaining the assumption.

INDUSTRY DEFAULTS for envelope upgrades (residential row/townhouse, Alberta Building Code):
- Gross wall area per townhouse unit: ~110 m2; deduct ~12% for openings.
- Window area per unit: ~10% of wall area; typical unit has 6-8 windows.
- Doors: 2 per unit (front + rear), steel-clad insulated, 1 3/4" thick.
- Exterior insulation: 3/8" (9.53 mm) fanfold + 19x64 pressure treated strapping over existing plywood sheathing; Tyvek air barrier over full wall area.
- Attic insulation: blown cellulose to 18" depth, ~1 attic per unit; include attic hatch insulation + weatherstrip per unit.
- Flashings: window/door head drip caps with end dams — allow 1.2 m per opening; roof-to-wall flashing per building perimeter; kick-out diverters at every eavestrough termination.
- Battens: 1" x 3 1/2" concrete faced insulation board around all windows and doors — perimeter of each opening.
- Unit number plaques: 12"x12"x1" smartboard, 2 per unit (front and rear).
- Electrical: doorbell front + rear per unit, 1 entry light per door, GFCI receptacle with all-weather cover per unit, meter backer board per unit; box extensions required for added insulation thickness (ticketed electrician).
- Eaves: continuous 5" eavestrough at all eave lines, downspouts ~1 per 12 m of eave, tied into existing weeping tile.
- Parging: acrylic parging on exposed foundation, ~0.6 m high around building perimeter.
- General conditions: site fencing around the full work zone, waste/recycling bins, portable toilets, permits, tenant protection.

WORKFLOW RULES:
1. When the user gives ANY scope, building count, unit count, or pasted scope-of-work text, IMMEDIATELY call add_building_items with real numbers for every trade covered by that scope.
2. NEVER ask "anything else?" — add what was given, note assumptions, and stop.
3. When the user pastes or describes a scope of work (e.g. "building envelope upgrades, 24 units"), generate a COMPLETE trade-by-trade takeoff: demolition, parging, flashings/battens, siding & insulation, windows, doors, attic insulation, ventilation, electrical, eaves/downspouts, and general conditions.
4. Set "package" to a logical grouping when obvious (e.g. "Building A", "Envelope", "Interior").
5. Keep the chat reply SHORT — you are talking to people on site. Confirm what you added and flag assumptions.
6. Metric metres/m2 internally. Convert feet (x0.3048) and inches (x0.0254) and mm (/1000).

DRAWINGS & SPEC DOCUMENTS:
When PDFs, plan images, elevations or specification documents are attached:
1. Read every sheet: elevations, floor plans, wall sections, window/door schedules, finish schedules, and general notes.
2. Take quantities off the schedules first (window/door counts and sizes, unit counts), then measure areas from plan/elevation dimensions.
3. Convert imperial callouts (feet-inches) to metres. Note the scale or dimension source in the "note" field, e.g. "From A2.1 elevation, 12.2m x 8.5m".
4. If a sheet is unreadable or a dimension is missing, use the industry defaults and say so in the note — never skip the trade.
5. Cover the whole scope shown, trade by trade, including demolition and general conditions.

Provide numbers, not question marks.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, files } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Build the outgoing message list; when drawings/specs are uploaded, attach them
    // as multimodal blocks on the last user message.
    const outgoing: any[] = Array.isArray(messages) ? [...messages] : [];
    const attachments: any[] = Array.isArray(files) ? files : [];

    if (attachments.length > 0) {
      const blocks: any[] = [];
      const promptText =
        typeof outgoing[outgoing.length - 1]?.content === "string" && outgoing[outgoing.length - 1].content.trim()
          ? outgoing.pop().content
          : "Read the attached drawings / specifications and produce a complete measured building-works takeoff. Use scaled dimensions, schedules (window/door schedules), elevations and notes where present. Where a dimension is not shown, use the industry defaults and add a note.";
      blocks.push({ type: "text", text: promptText });

      for (const f of attachments) {
        const mime: string = f?.mimeType || "application/pdf";
        const dataUrl: string = f?.dataUrl || "";
        if (!dataUrl) continue;
        if (mime.startsWith("image/")) {
          blocks.push({ type: "image_url", image_url: { url: dataUrl } });
        } else if (mime === "application/pdf") {
          blocks.push({ type: "file", file: { filename: f?.name || "drawing.pdf", file_data: dataUrl } });
        } else if (f?.text) {
          blocks.push({ type: "text", text: `--- ${f?.name || "document"} ---\n${f.text}` });
        }
      }
      outgoing.push({ role: "user", content: blocks });
    }

    const makeRequest = async () =>
      await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "system", content: SYSTEM_PROMPT }, ...outgoing],

          tools: [
            {
              type: "function",
              function: {
                name: "add_building_items",
                description: "Add measured non-concrete work, including heavy-industrial mechanical piping, fittings, valves, equipment, insulation and testing allowances, to the takeoff sheet",
                parameters: {
                  type: "object",
                  properties: {
                    drawingAudit: {
                      type: "object",
                      properties: {
                        sheetsRead: { type: "array", items: { type: "string" } },
                        uncertainties: { type: "array", items: { type: "string" } },
                        exclusions: { type: "array", items: { type: "string" } },
                      },
                      required: ["sheetsRead", "uncertainties", "exclusions"],
                      additionalProperties: false,
                    },
                    items: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          trade: { type: "string", enum: TRADES },
                          description: { type: "string", description: "Short work item label, e.g. 'Hardie board siding - front elevation'" },
                          quantity: { type: "number", description: "Count / number of occurrences" },
                          length: { type: "number", description: "Length in metres; for m3/t, measured volume/mass per occurrence (0 for count items)" },
                          width: { type: "number", description: "Width or height in metres for area items (0 otherwise)" },
                          uom: { type: "string", enum: ["m2", "m3", "t", "m", "ea", "unit", "ls"] },
                          package: { type: "string", description: "Logical grouping such as 'Building A' or 'Envelope'" },
                          note: { type: "string", description: "Assumption, spec reference, or missing-info note" },
                        },
                        required: ["trade", "description", "quantity", "length", "width", "uom", "note"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["items"],
                  additionalProperties: false,
                },
              },
            },
          ],
        }),
      });

    let response = await makeRequest();

    if (response.status === 502 || response.status === 503) {
      await response.text();
      await new Promise((r) => setTimeout(r, 3000));
      response = await makeRequest();
    }

    if (!response.ok) {
      const status = response.status;
      const body = await response.json().catch(() => ({}));
      const safeMessage = body.message || body.error?.message || (typeof body.error === "string" ? body.error : "VoxPlan could not complete the takeoff request.");
      console.error("AI gateway error:", status);
      if (status === 400 || status === 401 || status === 403 || status === 404) {
        return new Response(JSON.stringify({ error: safeMessage }), {
          status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "Usage limit reached. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 502 || status === 503) {
        return new Response(JSON.stringify({ error: "AI service temporarily unavailable. Please try again in a moment." }), {
          status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "AI service error. Please try again." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let data = await response.json();

    // A content refusal or empty successful response is terminal, not a retry trigger.
    const hasTools = (d: any) => (d?.choices?.[0]?.message?.tool_calls?.length ?? 0) > 0;
    if (!hasTools(data) && !data?.choices?.[0]?.message?.content) {
      return new Response(JSON.stringify({ error: "The document analysis returned no usable result. No quantities were added." }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("building-takeoff-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
