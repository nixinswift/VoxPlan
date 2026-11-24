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

const SYSTEM_PROMPT = `You are VoxPlan's multidisciplinary drawing takeoff estimator. Read the actual supplied scope, including civil earthworks, not just concrete. Support industrial mechanical isometrics, P&IDs, equipment drawings, BOMs, building, electrical and concrete drawings.
${MECHANICAL_ESTIMATING_GUIDANCE}
${CIVIL_ESTIMATING_GUIDANCE}
${TECHNICAL_DRAWING_GUIDANCE}
Identify all supported quantities across every supplied sheet. Use add_items ONLY for concrete slabs, footings and walls; use add_building_items for all non-concrete scope, trade=mechanical for industrial mechanical. Mixed drawings may call both tools. A drawing without concrete is valid: never reject it or invent concrete, envelope or residential scope.
Concrete: quantity counts identical elements; slab/footing volume = quantity x (area or length x width) x thickness; wall volume = quantity x (area or length x width) x height. Keep feet in ft or metres in m; convert mm to m. Preserve TOC/TOW/TOF/BOF/FFE callouts and derive dimensions only when supported. Leave unknown dimensions 0 and explain the missing evidence; do not substitute industry defaults for measured drawing quantities.
Non-concrete: metres/m2 internally; quantity counts identical runs/items, length stores metres per run. Counts use ea, areas m2, linear quantities m. Preserve tags, size, material and ratings in descriptions.
Detect package from title blocks/system/area; leave empty if unknown. Every note must include file/sheet, callout evidence and measured/derived/provisional status. Include drawingAudit (sheetsRead, uncertainties, exclusions) with non-concrete results, including an empty items array when scope is unquantifiable. Use a short explanatory reply for missing evidence, not fabricated items. Results are proposed for user review, not automatically saved.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image, mimeType, fileName, followUpMessages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    if (!image) throw new Error("No image provided");

    const baseMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Read ${fileName || "drawing"}. Identify the actual disciplines and return all supported concrete, building, electrical and industrial mechanical quantities using the appropriate tools. Do not require concrete. Preserve evidence and flag missing information.`,
          },
          mimeType === "application/pdf"
            ? { type: "file", file: { filename: fileName || "drawing.pdf", file_data: `data:application/pdf;base64,${image}` } }
            : { type: "image_url", image_url: { url: `data:${mimeType || "image/png"};base64,${image}` } },
        ],
      },
    ];

    // If follow-up messages provided, append them
    const messages = followUpMessages
      ? [...baseMessages, ...followUpMessages]
      : baseMessages;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
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
          {
            type: "function",
            function: {
              name: "add_items",
              description: "Add concrete items extracted from the drawing to the quantity takeoff sheet",
              parameters: {
                type: "object",
                properties: {
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        category: { type: "string", enum: ["slab", "footing", "wall"] },
                        description: { type: "string", description: "Descriptive label from the drawing" },
                        quantity: { type: "number", description: "Number of this element" },
                        length: { type: "number", description: "Length in meters (0 if unknown)" },
                        width: { type: "number", description: "Width in meters (0 if unknown)" },
                        thickness: { type: "number", description: "Thickness in meters for slabs/footings (0 if unknown)" },
                        height: { type: "number", description: "Height in meters for walls (0 if unknown)" },
                        area: { type: "number", description: "Area in m² (use instead of length+width when area is provided)" },
                        unit: { type: "string", enum: ["m", "ft"], description: "Unit system" },
                        package: { type: "string", description: "Package/building/zone name detected from drawing title block (e.g. 'Building A', 'Phase 2'). Empty string if not detected." },
                        note: { type: "string", description: "Note about missing dimensions or special conditions. REQUIRED when any dimension is 0." },
                      },
                      required: ["category", "description", "quantity", "length", "width", "thickness", "package", "note"],
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
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-drawing error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
