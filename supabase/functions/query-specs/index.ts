import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { streamText } from "npm:ai";
import { z } from "npm:zod";
import { MECHANICAL_SCHEDULING_GUIDANCE, MECHANICAL_ESTIMATING_GUIDANCE } from "../_shared/mechanical-planning.ts";
import { TECHNICAL_DRAWING_GUIDANCE } from "../_shared/technical-drawings.ts";
import {
  createLovableAiGatewayProvider,
  getLovableAiGatewayResponseHeaders,
  getLovableAiGatewayRunId,
} from "../_shared/ai-gateway.ts";

const BodySchema = z.object({
  projectId: z.string().uuid(),
  question: z.string().trim().min(1).max(5000),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(10000),
  })).max(10).default([]),
});

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "Invalid question or project" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const { projectId, question, messages } = parsed.data;

    // Get auth token from request
    const authHeader = req.headers.get('Authorization');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!authHeader?.startsWith("Bearer ") || !supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify({ error: "Please sign in again" }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Your session expired. Please sign in again." }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch all spec documents for this project
    const { data: specs, error: specsError } = await supabase
      .from('project_specs')
      .select('file_name, extracted_text')
      .eq('project_id', projectId);

    if (specsError) {
      console.error("Error fetching specs:", specsError);
      throw new Error("Failed to fetch project specs");
    }

    if (!specs || specs.length === 0) {
      return new Response(
        JSON.stringify({ 
          answer: "No specification documents have been uploaded for this project yet. Please upload your specs first using the upload button, then ask me questions about them." 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build context from all spec documents
    const specsContext = specs
      .filter(s => s.extracted_text && s.extracted_text.trim().length > 0)
      .map(s => `--- Document: ${s.file_name} ---\n${s.extracted_text}`)
      .join('\n\n');

    if (!specsContext.trim()) {
      return new Response(
        JSON.stringify({ 
          answer: "The uploaded documents don't contain any readable text yet. Try uploading clearer documents or PDFs with selectable text." 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const systemPrompt = `You are VoxBuddy, a construction specifications expert assistant. You have access to the project's uploaded specification documents.

${MECHANICAL_SCHEDULING_GUIDANCE}
${MECHANICAL_ESTIMATING_GUIDANCE}
${TECHNICAL_DRAWING_GUIDANCE}
This is a read-only specifications conversation: do not claim to call takeoff tools, add estimate lines or change a schedule. Explain proposed quantities and scheduling logic from the documents instead.

Your job is to answer questions about the specs accurately and concisely. When answering:
- Reference the specific document and section when possible
- If the specs mention specific materials, brands, standards (ASTM, CSI, etc.), include those details
- If you can't find the answer in the specs, say so clearly - don't make up information
- Keep answers practical and actionable for field crews and estimators
- Use construction industry terminology appropriately

Here are the project specification documents:

${specsContext}`;

    // Build conversation messages
    const conversationMessages = [
      ...messages,
      { role: "user" as const, content: question },
    ];

    console.log(`Querying specs for project ${projectId}, ${specs.length} docs loaded`);

    const initialRunId = getLovableAiGatewayRunId(req);
    const gateway = createLovableAiGatewayProvider(LOVABLE_API_KEY, initialRunId);
    const result = streamText({
      model: gateway("google/gemini-3.6-flash"),
      system: systemPrompt,
      messages: conversationMessages,
      temperature: 0.2,
      maxRetries: 1,
    });
    const answer = await result.text;

    if (typeof answer !== "string" || !answer.trim()) {
      throw new Error("The AI service returned an empty response");
    }

    const providerResponse = await result.response;
    const responseHeaders = getLovableAiGatewayResponseHeaders(providerResponse.headers, {
      ...corsHeaders,
      'Content-Type': 'application/json',
    });

    return new Response(
      JSON.stringify({ answer: answer.trim() }),
      { headers: responseHeaders },
    );

  } catch (error) {
    console.error("Error in query-specs:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("429") ? 429 : message.includes("402") ? 402 : 500;
    const publicMessage = status === 429
      ? "AI is busy right now. Please try again shortly."
      : status === 402
        ? "AI credits are exhausted. Please add credits in Plans & credits."
        : message;
    return new Response(JSON.stringify({ error: publicMessage }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
