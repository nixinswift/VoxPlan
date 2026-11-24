import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Task {
  id: string;
  name: string;
  trade: string;
  manpower: number;
  duration: number;
  startDate: string;
  equipment?: string;
  notes?: string;
}

interface ShiftRecord {
  date: string;
  worker_count: number;
  task_id: string;
  task_name: string;
  trade: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Input validation
    const tasksSchema = z.object({
      tasks: z.array(z.object({
        id: z.string(),
        name: z.string().max(500),
        trade: z.string().max(100),
        manpower: z.number().int().min(0).max(10000),
        duration: z.number().int().min(0).max(1000),
        startDate: z.string()
      })).max(1000, 'Too many tasks (max 1000)')
    });

    const body = await req.json();
    const validationResult = tasksSchema.safeParse(body);
    
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

    const { tasks } = validationResult.data;
    
    if (!tasks || !Array.isArray(tasks)) {
      return new Response(
        JSON.stringify({ error: "Invalid input: tasks array required" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Analyzing manpower for ${tasks.length} tasks`);

    // Transform tasks into daily shift records
    const shiftRecords: ShiftRecord[] = [];
    
    for (const task of tasks) {
      const startDate = new Date(task.startDate);
      
      for (let day = 0; day < task.duration; day++) {
        const currentDate = new Date(startDate);
        currentDate.setDate(currentDate.getDate() + day);
        
        shiftRecords.push({
          date: currentDate.toISOString().split('T')[0],
          worker_count: task.manpower,
          task_id: task.id,
          task_name: task.name,
          trade: task.trade,
        });
      }
    }

    console.log(`Generated ${shiftRecords.length} shift records`);

    // Prepare AI prompt
    const systemPrompt = `You are a scheduling analysis engine for a construction staffing platform.
Your only job is to analyze manpower on site per day and return a clean JSON object.

CRITICAL CONCEPT - Trade-Based Worker Pooling:
Workers of the SAME TRADE are a shared pool. When an abatement task ends on Day 10 and another abatement task starts on Day 11, those are the SAME workers transferring - NOT new hires.

For daily counting:
- For each day, group workers by trade
- Within each trade: SUM concurrent workers (tasks that overlap on the same day need separate workers)
- Across trades: SUM the trade totals (different trades need different workers)

Example:
- Abatement Task A: 10 workers, Days 1-5
- Abatement Task B: 8 workers, Days 6-10 (same workers transfer from Task A, plus any difference)
- Electrical Task C: 5 workers, Days 3-8

Day 4 calculation:
- Abatement: 10 (only Task A active)
- Electrical: 5 (Task C active)
- Total: 15 workers

Day 7 calculation:
- Abatement: 8 (only Task B active - workers transferred from Task A)
- Electrical: 5 (Task C active)
- Total: 13 workers

Input: You will receive structured data with one record per scheduled shift. Each record includes:
- date (YYYY-MM-DD)
- worker_count (number of workers for that shift)
- task_id and task_name (for context)
- trade (worker specialty)

Your tasks:
1. For each day, group records by trade, then sum concurrent workers within each trade.
2. Build a manpower curve: a list of days with the total headcount per day.
3. Calculate the day-to-day change in headcount (delta) for each day compared to the previous day.
4. Flag any spikes or drops that may need attention.
5. Do not invent data. Only use records that are present in the input.

Output format (JSON only, no prose):
{
  "manpower_curve": [
    {
      "date": "YYYY-MM-DD",
      "total_workers": 0,
      "delta_from_previous_day": 0
    }
  ],
  "summary": {
    "min_workers": 0,
    "max_workers": 0,
    "average_workers": 0,
    "biggest_increase": {
      "from_date": "YYYY-MM-DD",
      "to_date": "YYYY-MM-DD",
      "from_workers": 0,
      "to_workers": 0
    },
    "biggest_drop": {
      "from_date": "YYYY-MM-DD",
      "to_date": "YYYY-MM-DD",
      "from_workers": 0,
      "to_workers": 0
    }
  },
  "alerts": [
    {
      "type": "spike_or_drop",
      "message": "Short human-readable description of the issue",
      "date": "YYYY-MM-DD",
      "previous_day_workers": 0,
      "current_day_workers": 0
    }
  ]
}

Alert rules:
- Flag if headcount changes by +/- 50% or more from one day to the next.
- Always flag if change is +/- 20 workers or more, even if percentage is small.
- If there is no previous day for the first entry, set delta_from_previous_day to null.

Return ONLY valid JSON. No markdown, no extra text, no code blocks.`;

    const userPrompt = `Analyze the following shift records and generate a manpower analysis:\n\n${JSON.stringify(shiftRecords, null, 2)}`;

    // Call Lovable AI
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    console.log("Calling Lovable AI for analysis...");

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

    console.log("Successfully analyzed manpower data");

    return new Response(
      JSON.stringify(analysisResult),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error("Error in analyze-manpower function:", error);
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
