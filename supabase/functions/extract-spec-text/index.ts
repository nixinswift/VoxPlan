import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { TECHNICAL_EXTRACTION_PROMPT } from "../_shared/technical-drawings.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function toBase64(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < arr.length; i += chunkSize) {
    binary += String.fromCharCode(...arr.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { specId, filePath, fileType } = await req.json();

    if (!specId || !filePath) {
      return new Response(
        JSON.stringify({ error: "specId and filePath are required" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) throw new Error("Document storage is not configured");
    const supabase = createClient(supabaseUrl, serviceKey);

    // Download the file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('project-specs')
      .download(filePath);

    if (downloadError || !fileData) {
      console.error("Download error:", downloadError);
      throw new Error("Failed to download file from storage");
    }

    let extractedText = "";
    const isImage = fileType?.startsWith('image/');
    const isPDF = fileType === 'application/pdf';

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    if (isImage) {
      // Use vision model to extract text from images
      const bytes = await fileData.arrayBuffer();
      const base64 = toBase64(bytes);
      const mimeType = fileType || 'image/png';

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: TECHNICAL_EXTRACTION_PROMPT
                },
                {
                  type: "image_url",
                  image_url: { url: `data:${mimeType};base64,${base64}` }
                }
              ]
            }
          ],
          temperature: 0.1,
          max_tokens: 8000,
        }),
      });

      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        console.error("AI error:", aiResponse.status, errText);
        throw new Error("Failed to extract text from image");
      }

      const aiData = await aiResponse.json();
      if (aiData.choices?.[0]?.finish_reason === "length") throw new Error("Document extraction was incomplete. Split the document into smaller sheet sets before processing.");
      extractedText = aiData.choices?.[0]?.message?.content || "";

    } else if (isPDF) {
      // For PDFs, convert to base64 and use Gemini's document understanding
      const bytes = await fileData.arrayBuffer();
      const base64 = toBase64(bytes);


      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: TECHNICAL_EXTRACTION_PROMPT
                },
                {
                  type: "file",
                  file: { filename: filePath.split('/').pop() || "spec.pdf", file_data: `data:application/pdf;base64,${base64}` }
                }
              ]
            }
          ],
          temperature: 0.1,
          max_tokens: 8000,
        }),
      });

      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        console.error("AI PDF error:", aiResponse.status, errText);
        throw new Error("Failed to extract text from PDF");
      }

      const aiData = await aiResponse.json();
      if (aiData.choices?.[0]?.finish_reason === "length") throw new Error("Document extraction was incomplete. Split the document into smaller sheet sets before processing.");
      extractedText = aiData.choices?.[0]?.message?.content || "";

    } else {
      // Plain text files
      extractedText = await fileData.text();
    }

    if (!extractedText.trim()) throw new Error("No readable drawing information was extracted. No document text was saved.");
    // Update the spec record with extracted text
    const { error: updateError } = await supabase
      .from('project_specs')
      .update({ extracted_text: extractedText })
      .eq('id', specId);

    if (updateError) {
      console.error("Update error:", updateError);
      throw new Error("Failed to save extracted text");
    }

    console.log(`Extracted ${extractedText.length} chars from ${filePath}`);

    return new Response(
      JSON.stringify({ success: true, textLength: extractedText.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("Error in extract-spec-text:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
