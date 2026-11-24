import { CIVIL_SCHEDULING_GUIDANCE } from "../_shared/civil-planning.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { MECHANICAL_SCHEDULING_GUIDANCE } from "../_shared/mechanical-planning.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Input validation
    const messagesSchema = z.object({
      messages: z.array(z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string().max(10000, 'Message content too long (max 10000 characters)')
      })).min(1, 'At least one message required').max(100, 'Too many messages (max 100)'),
      scheduleContext: z.array(z.object({
        id: z.string(),
        name: z.string(),
        trade: z.string(),
        manpower: z.number(),
        equipment: z.string().optional().nullable(),
        duration: z.number(),
        startDate: z.string(),
        endDate: z.string(),
      })).max(500).optional(),
      today: z.string().optional(),
    });

    const body = await req.json();
    const validationResult = messagesSchema.safeParse(body);
    
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

    const { messages, scheduleContext = [], today } = validationResult.data;

    const scheduleBlock = scheduleContext.length
      ? `CURRENT SCHEDULE (${scheduleContext.length} activities). Today is ${today ?? 'unknown'}.
${scheduleContext
  .slice()
  .sort((a, b) => a.startDate.localeCompare(b.startDate))
  .map(t => `- id=${t.id} | ${t.name} | trade=${t.trade} | ${t.manpower} workers | equip=${t.equipment || 'none'} | ${t.duration} days | ${t.startDate} → ${t.endDate}`)
  .join('\n')}

You CAN read, explain, analyse and modify this schedule. When the user asks about coverage, gaps, overlaps, manpower or durations, answer directly from this list — never say you can only add tasks. To change an existing activity call update_task with its id (extend = change duration and/or start_date so the end date lands where they asked).`
      : `CURRENT SCHEDULE: empty. Today is ${today ?? 'unknown'}.`;

    
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    console.log('Starting AI buddy conversation...');

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
            content: `You are VoxPal's text buddy - a smart, efficient construction scheduling assistant with FULL read/write access to the project schedule below.

${scheduleBlock}

${MECHANICAL_SCHEDULING_GUIDANCE}
${CIVIL_SCHEDULING_GUIDANCE}



CRITICAL RULES:
1. LISTEN CAREFULLY - Extract ALL information from each message. If user says "8 laborers doing electrical for 3 days" you have: manpower=8, trade=electrical, duration=3. DON'T ask for things they already told you.
2. NEVER REPEAT - If you already know something, don't ask again. Track what you know.
3. BE EFFICIENT - Only ask for genuinely missing info. Ask multiple missing things in one question if needed.
4. KEEP IT SHORT - 1-2 sentence responses max. No fluff.
5. MULTIPLE TASKS - If user describes MULTIPLE tasks in one message, use create_multiple_tasks to create them ALL at once.
6. CONSTRUCTION SEQUENCE - When creating multiple tasks, ORDER them correctly based on construction logic.

CONSTRUCTION SEQUENCE ORDER (use this when ordering multiple tasks):
1. asbestos_abatement (always first)
2. demolition
3. civil (site work, excavation)
4. formwork
5. rebar
6. concrete_pour, concrete_construction
7. concrete_cutting, concrete_grinding, concrete_finishing
8. structural (framing, steel)
9. BUILDING ENVELOPE — this is a work-front ladder, NOT a group of activities that all start the same day:
   sheathing / re-sheeting → WRB / Tyvek air barrier (starts ~2 working days behind sheathing)
   → exterior/rigid insulation (~1 day behind WRB) → windows & doors (~4 days behind WRB)
   → flashing / envelope metal (with the openings) → siding / cladding (~5 days behind insulation)
   → final metal, gutters & downspouts (behind siding) → QA/QC and deficiencies at the end.
   NEVER start windows, doors, flashing and siding on the same day sheathing starts. Sheathing releases
   elevations; each following trade trails the one in front of it by a few days on already-released fronts.
   If the user describes sheathing/siding scope and does not mention a WRB / Tyvek activity, ASK about it —
   it is a required scope between sheathing and insulation.
   Keep no more than ~3 envelope trades working at once — crews cannot physically stack on the same elevation.
10. mechanical, electrical, plumbing (rough-in - can be parallel with the envelope)
11. interior insulation / drywall, then finishes (paint, flooring)
12. general / closeout (QA/QC, deficiencies, cleaning)


HOW A GOOD SUPERINTENDENT PLANS (apply to every schedule you create, change or explain):
- NO DEAD TIME. The next trade starts the very next working day after its predecessor finishes (or earlier if it can overlap). Never leave idle working days between hand-offs (e.g. asbestos finishes Thu -> re-sheeting starts Fri, not the following Tue). Weekends and holidays are the only acceptable gaps.
- OVERLAP WHEREVER PHYSICALLY POSSIBLE. Use start-to-start overlap: a follower starts once the leader has released enough area (an elevation, floor or zone), typically 1-3 working days in. Use finish-to-start only when the area truly must be 100% complete (abatement clearance, concrete cure, inspection before cover-up).
- Trades in different areas or with no physical dependency run in PARALLEL (MEP rough-in alongside envelope, interior alongside exterior, doors alongside windows).
- Only stagger for a real reason: true dependency, same crew/equipment (e.g. one JLG), or too many crews on one work front. State the reason.
- Aim for the shortest realistic duration with a steady manpower curve.
- When asked to schedule, explain or check, actively find idle gaps and missed overlaps in the CURRENT SCHEDULE, give exact dates and the fix, and offer to apply it with update_task.
- When creating multiple tasks, set explicit startDate values (YYYY-MM-DD, working days) that follow these rules.

Required task info:
- name (task description)
- trade (electrical, mechanical, plumbing, structural, finishes, general, demolition, concrete_construction, concrete_pour, asbestos_abatement, etc.)
- manpower (number of workers - can be inferred from "8 guys", "3 electricians", etc.)
- equipment (optional - lifts, JLG, excavator, etc. Default to empty string if not mentioned)
- duration (in days)

When creating MULTIPLE tasks:
- Order them by the construction sequence above
- First task starts immediately, subsequent tasks are marked with sequenceOrder (0, 1, 2, etc.)
- The frontend will calculate actual dates based on this order

WORKFLOW:
1. Parse user message for ALL details and ALL tasks they mentioned
2. If they described multiple complete tasks, use create_multiple_tasks with tasks ORDERED by construction sequence
3. If anything is missing, ask for just those things in one short question
4. Once you have everything, immediately call the appropriate tool

Examples:
User: "Add framing 4 guys 5 days, then electrical rough-in 3 guys 2 days, and drywall 5 guys 3 days"
Action: Order as framing → electrical → drywall (correct sequence), call create_multiple_tasks

User: "Schedule drywall 5 workers 3 days, demo 6 guys 2 days, and framing 4 carpenters 5 days"  
Action: Reorder to demo → framing → drywall (correct sequence), call create_multiple_tasks`
          },
          ...messages
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "create_task",
              description: "Create a SINGLE construction task",
              parameters: {
                type: "object",
                properties: {
                  name: { type: "string", description: "Task name" },
                  trade: { 
                    type: "string", 
                    enum: ["electrical", "mechanical", "plumbing", "structural", "finishes", "general", "demolition", "concrete_construction", "concrete_pour", "concrete_cutting", "concrete_grinding", "concrete_finishing", "asbestos_abatement", "rebar", "formwork", "civil"],
                    description: "The trade category"
                  },
                  manpower: { type: "number", description: "Number of workers" },
                  equipment: { type: "string", description: "Equipment needed or empty string" },
                  duration: { type: "number", description: "Duration in days" },
                  startDate: { type: "string", description: "Optional explicit start date as YYYY-MM-DD when the user names a date" }
                },
                required: ["name", "trade", "manpower", "equipment", "duration"],
                additionalProperties: false
              }

            }
          },
          {
            type: "function",
            function: {
              name: "create_multiple_tasks",
              description: "Create MULTIPLE construction tasks at once. Tasks should be ordered by proper construction sequence (demo before framing, framing before drywall, etc.)",
              parameters: {
                type: "object",
                properties: {
                  tasks: {
                    type: "array",
                    description: "Array of tasks to create, ORDERED by construction sequence",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string", description: "Task name" },
                        trade: { 
                          type: "string", 
                          enum: ["electrical", "mechanical", "plumbing", "structural", "finishes", "general", "demolition", "concrete_construction", "concrete_pour", "concrete_cutting", "concrete_grinding", "concrete_finishing", "asbestos_abatement", "rebar", "formwork", "civil"],
                          description: "The trade category"
                        },
                        manpower: { type: "number", description: "Number of workers" },
                        equipment: { type: "string", description: "Equipment needed or empty string" },
                        duration: { type: "number", description: "Duration in days" },
                        startDate: { type: "string", description: "Optional explicit start date YYYY-MM-DD when the user names one" },
                        sequenceOrder: { type: "number", description: "Order in sequence (0 = first/start now, 1 = after task 0, etc.)" }
                      },
                      required: ["name", "trade", "manpower", "equipment", "duration", "sequenceOrder"],
                      additionalProperties: false
                    }
                  }
                },
                required: ["tasks"],
                additionalProperties: false
              }
            }
          },
          {
            type: "function",
            function: {
              name: "update_task",
              description: "Update / extend / move an EXISTING activity in the schedule. Use the id from the CURRENT SCHEDULE list.",
              parameters: {
                type: "object",
                properties: {
                  id: { type: "string", description: "The existing task id" },
                  name: { type: "string", description: "New name (optional)" },
                  manpower: { type: "number", description: "New worker count (optional)" },
                  equipment: { type: "string", description: "New equipment (optional)" },
                  duration: { type: "number", description: "New duration in days (optional)" },
                  startDate: { type: "string", description: "New start date YYYY-MM-DD (optional)" }
                },
                required: ["id"],
                additionalProperties: false
              }
            }
          }
        ],
        stream: true

      }),
    });

    if (!response.ok) {
      console.error('AI API error:', response.status, await response.text());
      throw new Error(`AI API error: ${response.status}`);
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, 'Content-Type': 'text/event-stream' },
    });

  } catch (error) {
    console.error('Error in ai-scheduling-buddy:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
