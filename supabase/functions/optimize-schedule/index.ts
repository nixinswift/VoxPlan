import { CIVIL_SCHEDULING_GUIDANCE } from "../_shared/civil-planning.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { MECHANICAL_SCHEDULING_GUIDANCE } from "../_shared/mechanical-planning.ts";

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
  equipment: string;
}

interface ResourceConstraint {
  type: "workers" | "equipment";
  name: string;
  available: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json() as {
      mode?: string;
      plan?: unknown;
      tasks?: Task[];
      optimizeTaskId?: string;
      optimizeTaskName?: string;
      constraints?: ResourceConstraint[];
    };
    const { tasks, optimizeTaskId, optimizeTaskName, constraints } = body;

    const LOVABLE_KEY = Deno.env.get('LOVABLE_API_KEY');

    // Review mode: the client already computed a deterministic, constraint-respecting
    // plan. The model only writes the superintendent-style commentary — it never
    // invents dates.
    if (body.mode === 'review') {
      if (!LOVABLE_KEY) throw new Error('LOVABLE_API_KEY not configured');

      const reviewRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${LOVABLE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            {
              role: 'system',
              content: `You are a senior construction superintendent reviewing a schedule that has ALREADY been computed by a deterministic scheduling engine (working calendar, phase sequencing, work-front hand-offs, crew pools, single-unit equipment).

${MECHANICAL_SCHEDULING_GUIDANCE}
${CIVIL_SCHEDULING_GUIDANCE}
If the supplied engine plan violates an industrial mechanical dependency or holds all mechanical tasks until an unrelated building phase completes, explicitly flag it; do not endorse the plan merely because it was computed.

The engine sequences the envelope as a work-front ladder: sheathing → WRB/Tyvek → exterior insulation → windows/doors → flashing → siding → final metal/gutters → QA/QC, with each trade trailing the one ahead of it by a few working days on released elevations (controlled overlap, never same-day pile-on).

PLANNING PRINCIPLES: no idle working days between hand-offs (next trade starts the next working day or overlaps), overlap start-to-start wherever the area is released, run independent trades in parallel, and stagger only for a real dependency, shared crew/equipment, or work-front congestion. Call out every idle gap and missed overlap you see.

RULES:
- NEVER invent or change dates. Only reference the dates given.
- Comment on constructability risk, crew sizing realism, missing predecessor activities (call out a missing WRB/Tyvek, flashing or QA/QC scope), permits/inspections, weather/curing, lay-down and access, and equipment sharing.
- Flag any day where more envelope crews are on the building than there are released elevations, and say what peak manpower is realistic.
- Be specific and blunt, like jobsite talk. 4-8 short bullet points, no preamble.
- If durations or crews look unrealistic for the scope, say so with a suggested range.`,

            },
            {
              role: 'user',
              content: `Deterministic plan:\n${JSON.stringify(body.plan, null, 2)}\n\nStated resource limits: ${JSON.stringify(constraints ?? [])}`,
            },
          ],
        }),
      });

      if (!reviewRes.ok) {
        const errText = await reviewRes.text();
        console.error('AI review error:', reviewRes.status, errText);
        throw new Error(`AI API error: ${reviewRes.status}`);
      }

      const reviewData = await reviewRes.json();
      const notes = reviewData.choices?.[0]?.message?.content ?? 'No additional notes.';
      return new Response(JSON.stringify({ notes }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    
    if (!tasks || tasks.length === 0) {
      return new Response(
        JSON.stringify({ suggestions: [], message: "No tasks to optimize" }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    // Create a lookup for AI to reference task IDs
    const taskDetails = tasks.map(t => 
      `- ID:${t.id} | "${t.name}" (${t.trade}): ${t.duration} days, ${t.manpower} workers, equipment: ${t.equipment || 'none'}, starts ${t.startDate}`
    ).join('\n');

    // Format constraints for AI
    const constraintText = constraints && constraints.length > 0
      ? `\n\nRESOURCE CONSTRAINTS:\n${constraints.map(c => 
          c.type === "workers" 
            ? `- ${c.name} trade: MAX ${c.available} workers available`
            : `- ${c.name}: Only ${c.available} available (tasks needing this equipment cannot fully overlap)`
        ).join('\n')}`
      : '';

    // Single task optimization mode
    if (optimizeTaskId && optimizeTaskName) {
      console.log('Optimizing single task:', optimizeTaskName, 'with constraints:', constraints);

      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            {
              role: 'system',
              content: `You are a construction schedule optimizer. Find the OPTIMAL start date for a specific task.

${MECHANICAL_SCHEDULING_GUIDANCE}
${CIVIL_SCHEDULING_GUIDANCE}

CONSTRUCTION SEQUENCE (correct order):
1. Asbestos abatement (always first)
2. Demolition
3. Civil/Site work
4. Concrete work (formwork → rebar → pour → finishing)
5. Structural/Framing
6. Rough-in work (electrical, mechanical, plumbing - CAN RUN IN PARALLEL)
7. Insulation
8. Drywall/Finishes (must be after framing and rough-ins)
9. Final finishes (paint, flooring, trim)

PARALLEL TRADES (can overlap):
- Electrical, Mechanical, Plumbing (rough-in phase)
- Multiple finishing trades

RESOURCE CONSTRAINT RULES:
- If tasks share LIMITED EQUIPMENT, they cannot fully overlap (stagger them)
- If a trade has LIMITED WORKERS, check if total manpower exceeds availability on overlapping dates
- Example: 3 swing stages means only 3 tasks using swing stages can run simultaneously

PLANNING PRINCIPLES: zero idle working days between hand-offs; overlap start-to-start as soon as the predecessor has released area (1-3 working days in); finish-to-start only for true dependencies (abatement clearance, cure, inspection).

RULES FOR OPTIMAL DATE:
1. Task must start AFTER any prerequisite trades complete
2. Consider starting parallel trades on the same date (if resources allow)
3. Minimize gaps - start as soon as predecessor finishes
4. Don't overlap incompatible trades
5. RESPECT RESOURCE CONSTRAINTS - stagger tasks that share limited resources

Return JSON:
{
  "optimizedDate": "YYYY-MM-DD" or null if no change needed,
  "reason": "Brief explanation including resource constraint considerations if applicable"
}`
            },
            {
              role: 'user',
              content: `Current schedule:\n${taskDetails}${constraintText}\n\nFind the OPTIMAL start date for task: "${optimizeTaskName}" (ID: ${optimizeTaskId})`
            }
          ],
          response_format: { type: "json_object" }
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('AI API error:', response.status, errText);
        throw new Error(`AI API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      
      if (!content) {
        throw new Error('No content in AI response');
      }

      console.log('Single task optimization result:', content);
      const result = JSON.parse(content);

      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Full schedule analysis mode
    console.log('Analyzing full schedule with', tasks.length, 'tasks and constraints:', constraints);

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `You are a construction schedule optimizer. Analyze the schedule and provide practical suggestions.

${MECHANICAL_SCHEDULING_GUIDANCE}
${CIVIL_SCHEDULING_GUIDANCE}

CONSTRUCTION SEQUENCE (correct order):
1. Asbestos abatement (always first if present)
2. Demolition
3. Civil/Site work
4. Concrete work (formwork → rebar → pour → finishing)
5. Structural/Framing
6. Rough-in work (electrical, mechanical, plumbing - CAN RUN IN PARALLEL)
7. Insulation
8. Drywall/Finishes (must be after framing and rough-ins)
9. Final finishes (paint, flooring, trim)

PARALLEL TRADES: These can run at the same time:
- Electrical, Mechanical, Plumbing (rough-in phase)
- Multiple finishing trades (paint, flooring, trim)

RESOURCE CONSTRAINTS ANALYSIS:
- Check if tasks sharing LIMITED EQUIPMENT are overlapping too much
- Check if trade manpower requirements exceed available workers
- Suggest staggering tasks that compete for the same limited resources
- Flag when equipment bottlenecks will cause delays

PLANNING PRINCIPLES: zero idle working days between hand-offs; overlap start-to-start wherever area is released; parallel independent trades; stagger only for real dependencies or shared resources. Every idle gap is a finding with a proposedStartDate that closes it.

ANALYZE FOR:
1. Sequence violations (e.g., drywall before framing, electrical before demo)
2. Manpower peaks/valleys (too many workers on same days)
3. Gap filling (idle time between sequential tasks)
4. Parallel opportunities (trades that SHOULD overlap but don't)
5. Duration concerns (tasks that seem too short/long)
6. RESOURCE CONFLICTS (tasks competing for limited equipment or workers)

CRITICAL: Use the EXACT task IDs provided (ID:xxx format). The taskId field MUST match exactly.

Return JSON with this structure:
{
  "overallScore": 0-100,
  "suggestions": [
    {
      "type": "sequence" | "manpower" | "gap" | "parallel" | "duration" | "resource",
      "severity": "high" | "medium" | "low",
      "taskId": "EXACT_TASK_ID_FROM_INPUT",
      "taskName": "task name for display",
      "issue": "Short description (include resource constraint if applicable)",
      "recommendation": "What to do",
      "proposedStartDate": "YYYY-MM-DD or null"
    }
  ],
  "summary": "One sentence summary"
}`
          },
          {
            role: 'user',
            content: `Analyze this construction schedule:\n\n${taskDetails}${constraintText}`
          }
        ],
        response_format: { type: "json_object" }
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('AI API error:', response.status, errText);
      throw new Error(`AI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      throw new Error('No content in AI response');
    }

    console.log('AI optimization result:', content);

    const result = JSON.parse(content);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in optimize-schedule:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
