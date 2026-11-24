import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EquipmentRecord {
  date: string;
  equipment_id: string;
  equipment_type: string;
  hours_run?: number;
  fuel_added_liters?: number;
  fuel_level_start?: number;
  fuel_level_end?: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Input validation
    const equipmentSchema = z.object({
      equipmentData: z.array(z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
        equipment_id: z.string().max(100),
        equipment_type: z.string().max(100),
        equipment_class: z.string().max(100).optional(),
        tonnage: z.number().min(0).max(1000).optional(),
        model_name: z.string().max(200).optional(),
        hours_run: z.number().min(0).max(24).optional(),
        base_burn_lph: z.number().min(0).max(200).optional(),
        idle_ratio: z.number().min(0).max(1).optional()
      })).max(1000, 'Too many equipment records (max 1000)')
    });

    let requestBody;
    try {
      requestBody = await req.json();
    } catch (parseError) {
      console.error("Failed to parse request body:", parseError);
      return new Response(
        JSON.stringify({ error: "Invalid JSON in request body" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const validationResult = equipmentSchema.safeParse(requestBody);
    
    if (!validationResult.success) {
      console.error('Validation error:', validationResult.error);
      return new Response(
        JSON.stringify({ 
          error: 'Invalid input', 
          details: validationResult.error.errors 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { equipmentData } = validationResult.data;

    console.log(`Analyzing fuel burn for ${equipmentData.length} equipment records`);

    // Prepare AI prompt
    const systemPrompt = `You are an advanced equipment fuel planning engine for a construction scheduler.
You must ESTIMATE fuel burn for planned work days using realistic but simple rules.

You will receive:
- project data (may include fuel_multiplier or season)
- an array of equipment_usage records, each with:
  - date (YYYY-MM-DD)
  - equipment_id
  - equipment_type (excavator, dozer, skid steer, truck, etc.)
  - equipment_class (optional, e.g. "medium_excavator", "small_dozer")
  - tonnage (optional, numeric, e.g. 22 for 22-ton excavator)
  - model_name (optional, e.g. "Cat 320GC")
  - hours_run (planned shift length; may be null)
  - base_burn_lph (optional override at equipment level)
  - idle_ratio (optional, 0–1; fraction of time idling)
- project-level fuel settings (optional):
  - fuel_multiplier (default 1.0; winter/heavy = 1.1–1.3, light = 0.8–0.9)

Your job:
1. Determine a realistic base burn-rate in liters per hour (base_lph) for each equipment record.
2. Adjust this for idle vs loaded time and project fuel_multiplier.
3. Output estimated daily fuel_burn_liters and effective_lph for each record.

Order of precedence for burn-rate:
1) If base_burn_lph is provided for the equipment record:
   - Use base_burn_lph as base_lph. Do NOT override it.
2) Else, if equipment_class is provided:
   - Use the default for that class (see class table below).
3) Else, infer class from equipment_type + tonnage + model_name:
   - If equipment_type includes "excavator":
       - If tonnage < 6 or model_name contains numbers 10–60 -> mini_excavator.
       - If tonnage 7–15 or model_name ~70–150 -> small_excavator.
       - If tonnage 16–25 or model_name ~200–250 -> medium_excavator.
       - If tonnage 26–40 or model_name ~300–380 -> large_excavator.
       - If tonnage > 40 or model_name ~400+ -> heavy_excavator.
   - If equipment_type includes "dozer":
       - Map approximate model codes:
         D3/D4/450/550 -> small_dozer
         D5/D6/650/700 -> medium_dozer
         D7/D8 -> large_dozer
         D9/D10 -> ultra_dozer
   - If equipment_type includes "skid" or "bobcat" -> skid_steer.
   - If equipment_type includes "telehandler" or "zoom boom" -> telehandler.
   - If equipment_type includes "truck" and NOT "dump" -> crew_truck.
   - If equipment_type includes "dump" or "tandem" -> dump_truck.
   - Otherwise -> general_equipment.
4) Once the class is known, use the class default L/hr below.

Class default burn-rates (liters per hour):
Excavators:
- mini_excavator:    5
- small_excavator:   10
- medium_excavator:  15
- large_excavator:   22
- heavy_excavator:   30

Dozers:
- small_dozer:  10
- medium_dozer: 16
- large_dozer:  30
- ultra_dozer:  50

Other equipment:
- skid_steer:    8
- telehandler:  10
- crew_truck:    3
- dump_truck:    6
- general_equipment: 4

Idle vs load adjustment:
- Let idle_ratio = provided idle_ratio if present, otherwise:
  - excavators and dozers: 0.30
  - skid steers: 0.25
  - telehandlers and trucks: 0.40
  - general equipment: 0.30
- Assume idle uses 40% of base_lph.
- Effective_lph = base_lph * ((1 - idle_ratio) + idle_ratio * 0.40)

If fuel_multiplier is provided at project level, apply it at the end:
- final_lph = Effective_lph * fuel_multiplier

Hours:
- If hours_run is missing or null, but there is a planned shift_length_hours, use shift_length_hours.
- If both are missing, assume 0 hours and fuel_burn_liters = 0.

Fuel calculation:
- fuel_burn_liters = final_lph * hours_run (rounded to one decimal place).

Output JSON ONLY in the following format (no prose, no markdown):

{
  "equipment_fuel_plan": [
    {
      "date": "YYYY-MM-DD",
      "equipment_id": "string",
      "equipment_type": "string",
      "equipment_class": "string",
      "hours_run": 0,
      "base_lph": 0,
      "effective_lph": 0,
      "fuel_multiplier": 1.0,
      "final_lph": 0,
      "fuel_burn_liters": 0
    }
  ]
}`;

    const userPrompt = `Analyze the following equipment usage records and generate a fuel burn analysis:\n\n${JSON.stringify(equipmentData, null, 2)}`;

    // Call Lovable AI
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    console.log("Calling Lovable AI for fuel analysis...");

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI Gateway error:", aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limits exceeded, please try again later." }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required, please add credits to your Lovable AI workspace." }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      throw new Error(`AI Gateway error: ${aiResponse.status} ${errorText}`);
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("No content in AI response");
    }

    console.log("AI Response received:", content.substring(0, 200) + "...");

    // Parse the JSON response from AI
    let analysisResult;
    try {
      // Remove markdown code blocks if present
      const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      analysisResult = JSON.parse(cleanContent);
    } catch (parseError) {
      console.error("Failed to parse AI response:", content);
      const errorMsg = parseError instanceof Error ? parseError.message : "Unknown parsing error";
      throw new Error(`Failed to parse AI response as JSON: ${errorMsg}`);
    }

    console.log("Successfully analyzed fuel burn data");

    return new Response(
      JSON.stringify(analysisResult),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error("Error in analyze-fuel-burn function:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Unknown error occurred"
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
