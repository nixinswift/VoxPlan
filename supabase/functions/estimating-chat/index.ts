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

const SYSTEM_PROMPT = `You are VoxPlan Estimator — a FULL construction quantity takeoff assistant. You do concrete AND all building works. Never tell the user you only handle concrete.

${MECHANICAL_ESTIMATING_GUIDANCE}
${CIVIL_ESTIMATING_GUIDANCE}

${TECHNICAL_DRAWING_GUIDANCE}

You have TWO tools. Pick whichever fits the work described, and call BOTH in the same reply when a scope covers both:
- add_items — CONCRETE only (slabs, footings, walls) with volume dimensions.
- add_building_items — EVERYTHING ELSE (measured building work: demolition, siding & insulation, windows, doors, flashings & trims, parging, attic insulation, ventilation, electrical, eaves & downspouts, roofing, painting, landscaping/repairs, general conditions).

=========================
CONCRETE (add_items)
=========================
Categories:
- slab: area OR (length + width), plus thickness.
- footing: area OR (length + width), plus thickness.
- wall: area OR (length + height), plus width (wall thickness).

Concrete industry defaults when a dimension is not given:
- Slab thickness: 6" (0.15 m) commercial, 4" (0.1 m) residential
- Strip footing: 2' wide x 1' deep (0.6 m x 0.3 m); pad footing 1' deep (0.3 m)
- Foundation wall: 8" thick (0.2 m), 8' tall (2.44 m)
- Grade beam: 12" wide x 24" deep (0.3 m x 0.6 m)
Volume = area x thickness (walls: area x width). When an area is given directly (e.g. "600 m2"), use the area field and set length/width to 0.

=========================
BUILDING WORKS (add_building_items)
=========================
TRADES (use exactly one id): ${TRADES.join(", ")}

UNITS OF MEASURE (uom):
- "m2" — wall/siding/insulation/parging/sheathing/house wrap/roofing/painting areas
- "m" — linear runs: flashings, battens, drip caps, eavestrough, downspouts, roof-to-wall flashing, fencing
- "ea" — countable items: windows, doors, doorbells, lights, receptacles, vents, hose bibbs, attic hatches, plaques
- "unit" — per dwelling unit items (attic insulation per suite, unit-number plaques per suite)
- "ls" — lump sum / general conditions (fencing, bins, permits, temporary facilities, tenant protection)

Quantity rules:
1. Area lines: give length + width in metres plus quantity (app computes quantity x length x width).
2. Linear lines: give length in metres plus quantity; width 0.
3. Count lines (ea/unit/ls): quantity only; length and width 0.

Building industry defaults (residential row/townhouse, Alberta Building Code):
- Gross wall area per townhouse unit ~110 m2; deduct ~12% for openings.
- Window area per unit ~10% of wall area; 6-8 windows per unit. Doors 2 per unit (steel-clad insulated).
- Exterior insulation: 3/8" fanfold + 19x64 PT strapping over existing sheathing; Tyvek over full wall area.
- Attic insulation: blown cellulose to 18"; 1 attic per unit + insulated/weatherstripped attic hatch per unit.
- Flashings: 1.2 m head drip cap per opening; roof-to-wall flashing per perimeter; kick-out diverters at eave terminations.
- Battens around all window/door perimeters.
- Electrical: doorbell front + rear per unit, entry light per door, GFCI with all-weather cover per unit, meter backer board, box extensions for added insulation (ticketed electrician).
- Eaves: continuous 5" eavestrough at all eave lines; ~1 downspout per 12 m of eave.
- Parging: acrylic parging ~0.6 m high around building perimeter.
- General conditions: site fencing, waste/recycling bins, portable toilets, permits, tenant protection.

=========================
WORKFLOW RULES (both disciplines)
=========================
1. When the user provides ANY scope, dimensions, building/unit counts, or pasted scope-of-work text, IMMEDIATELY call the right tool(s) with real numbers — even if some dimensions are missing.
2. NEVER ask "do you have more?" or "anything else?" — add what was given, note assumptions, confirm briefly.
3. Missing dimension? Use the defaults above and add a "note" like "Assumed standard 6in slab — update if different".
4. NEVER leave a dimension at 0 when it drives the quantity. Provide numbers, not question marks.
5. Accept m, mm (/1000), ft (x0.3048), in (x0.0254). Work internally in metres.
6. "4 footings at 2m x 1m x 0.5m" means quantity = 4. Multiple items in one call.
7. Set "package" to a logical grouping when obvious (e.g. "Building A", "Envelope").
8. For a pasted scope of work, generate a COMPLETE trade-by-trade takeoff, not one line.
9. Keep replies SHORT — you're talking to people on site.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const makeRequest = async () => {
      return await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...messages,
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "add_items",
                description: "Add one or more CONCRETE items (slab, footing, wall) to the concrete quantity takeoff sheet",
                parameters: {
                  type: "object",
                  properties: {
                    items: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          category: { type: "string", enum: ["slab", "footing", "wall"] },
                          description: { type: "string", description: "Short label like 'Ground Floor Slab' or 'Strip Footing F1'" },
                          quantity: { type: "number", description: "Number of this item type" },
                          length: { type: "number", description: "Length in meters (0 if unknown)" },
                          width: { type: "number", description: "Width in meters (0 if unknown)" },
                          thickness: { type: "number", description: "Thickness in meters for slabs/footings (0 if unknown)" },
                          height: { type: "number", description: "Height in meters for walls (0 if unknown)" },
                          area: { type: "number", description: "Area in m² (use instead of length+width when area is given directly)" },
                          unit: { type: "string", enum: ["m", "ft"], description: "Unit system, default m" },
                          package: { type: "string", description: "Logical grouping such as 'Building A'" },
                          note: { type: "string", description: "Note about missing dimensions or special conditions. REQUIRED when any dimension is 0 or unknown." },
                        },
                        required: ["category", "description", "quantity", "length", "width", "thickness"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["items"],
                  additionalProperties: false,
                },
              },
            },
            {
              type: "function",
              function: {
                name: "add_building_items",
                description: "Add measured non-concrete work, including heavy-industrial mechanical piping, fittings, valves, equipment, insulation and test-package allowances, to the takeoff sheet",
                parameters: {
                  type: "object",
                  properties: {
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
                        required: ["trade", "description", "quantity", "length", "width", "uom"],
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
    };

    let response = await makeRequest();

    // Retry once on transient 502/503 errors
    if (response.status === 502 || response.status === 503) {
      console.log(`AI gateway returned ${response.status}, retrying in 3s...`);
      await response.text(); // consume body
      await new Promise((r) => setTimeout(r, 3000));
      response = await makeRequest();
    }

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Usage limit reached. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 502 || response.status === 503) {
        return new Response(JSON.stringify({ error: "AI service temporarily unavailable. Please try again in a moment." }), {
          status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI service error. Please try again." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let data = await response.json();

    // Gemini occasionally returns MALFORMED_FUNCTION_CALL on large takeoffs — retry once.
    const usable = (d: any) =>
      (d?.choices?.[0]?.message?.tool_calls?.length ?? 0) > 0 || !!d?.choices?.[0]?.message?.content;
    if (!usable(data)) {
      console.log("No usable response, retrying once:", data?.choices?.[0]?.native_finish_reason);
      const retry = await makeRequest();
      if (retry.ok) {
        const retryData = await retry.json();
        if (usable(retryData)) data = retryData;
      } else {
        await retry.text();
      }
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("estimating-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
