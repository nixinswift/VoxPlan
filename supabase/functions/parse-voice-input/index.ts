import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

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
    const transcriptSchema = z.object({
      transcript: z.string()
        .min(1, 'Transcript cannot be empty')
        .max(5000, 'Transcript too long (max 5000 characters)')
    });

    const body = await req.json();
    const validationResult = transcriptSchema.safeParse(body);
    
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

    const { transcript } = validationResult.data;
    
    if (!transcript) {
      throw new Error('No transcript provided');
    }

    console.log('Parsing transcript:', transcript);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    // Use AI to parse the voice input with tool calling for structured output
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
            content: `You are a construction scheduling assistant. Parse voice input into structured task data.

For heavy-industrial work classify process/utility piping, spool fabrication/erection, pipefitters, welding, millwrights, pumps/compressors/vessels, rigging, NDE/PWHT, pressure testing, mechanical insulation and commissioning as mechanical unless another trade is explicitly given. Preserve line numbers, sizes, material classes, equipment tags and all supplied crew/duration/equipment details; do not replace them with generic building rough-in.

Extract the following information:
- name: The task/activity name (e.g., "Flooring", "Electrical rough-in"). Use context clues if not explicitly stated.
- trade: Must be one of: electrical, mechanical, plumbing, structural, finishes, general. Infer from task name if needed.
- manpower: Number of workers (default to 1 if not mentioned)
- equipment: Equipment needed (e.g., "2 lifts", "1 JLG", "3 scissors"). Use null if not mentioned.
- duration: Duration in days (convert weeks to days: 1 week = 7 days, 2.5 weeks = 18 days, round to nearest whole number). Default to 1 if not mentioned.

Be forgiving with messy input. Make reasonable inferences based on construction industry knowledge.`
          },
          {
            role: 'user',
            content: transcript
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "create_task",
              description: "Create a construction task from voice input",
              parameters: {
                type: "object",
                properties: {
                  name: { 
                    type: "string",
                    description: "The task name (e.g., 'Mechanical Install', 'Flooring')"
                  },
                  trade: { 
                    type: "string", 
                    enum: ["electrical", "mechanical", "plumbing", "structural", "finishes", "general"],
                    description: "The construction trade category"
                  },
                  manpower: { 
                    type: "number",
                    description: "Number of workers needed"
                  },
                  equipment: { 
                    type: "string",
                    description: "Equipment required (e.g., '2 lifts', '3 scissors'). Use null if not mentioned."
                  },
                  duration: { 
                    type: "number",
                    description: "Duration in days"
                  }
                },
                required: ["name", "trade", "manpower", "equipment", "duration"],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "create_task" } }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI API error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ 
            error: 'Rate limit reached. Please wait a moment before trying again.',
            rateLimited: true 
          }),
          {
            status: 429,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
      
      throw new Error(`AI API error: ${response.status}`);
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    
    console.log('AI response:', JSON.stringify(data.choices?.[0]?.message, null, 2));

    if (!toolCall || toolCall.function.name !== 'create_task') {
      throw new Error('No valid tool call in AI response');
    }

    // Parse the function arguments
    let parsed;
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      console.error('Failed to parse tool call arguments:', e);
      throw new Error('Invalid tool call arguments');
    }

    // Validate the parsed data
    if (!parsed.name || !parsed.trade) {
      throw new Error('Missing required fields in parsed data');
    }

    return new Response(
      JSON.stringify(parsed),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in parse-voice-input:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to parse input';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
