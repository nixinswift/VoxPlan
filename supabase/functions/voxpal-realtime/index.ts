import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { MECHANICAL_SCHEDULING_GUIDANCE } from "../_shared/mechanical-planning.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

serve(async (req) => {
  const upgrade = req.headers.get("upgrade") || "";
  
  if (upgrade.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket", { status: 426 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);
  let openAISocket: WebSocket | null = null;

  socket.onopen = () => {
    console.log("Client connected to VoxPal");

    if (!OPENAI_API_KEY) {
      console.error("OPENAI_API_KEY is not set");
      socket.send(
        JSON.stringify({
          type: "error",
          error: "Server misconfiguration: missing OpenAI API key",
        }),
      );
      socket.close();
      return;
    }

    try {
      // Connect directly to OpenAI Realtime API using subprotocols to pass the API key
      const wsUrl =
        "wss://api.openai.com/v1/realtime?model=gpt-realtime";
      console.log("Connecting to OpenAI WebSocket with subprotocols...");

      // NOTE: We use the `openai-insecure-api-key` subprotocol because browser-style
      // WebSocket clients (and Deno's WebSocket) can't send custom headers.
      // This connection happens server-side in this Edge Function, so the key
      // never reaches the browser.
      // GA API: do NOT send the "openai-beta.realtime-v1" subprotocol.
      openAISocket = new WebSocket(wsUrl, [
        "realtime",
        `openai-insecure-api-key.${OPENAI_API_KEY}`,
      ]);

      openAISocket.onopen = () => {
        console.log("Connected to OpenAI Realtime API");
      };

      openAISocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("OpenAI event type:", data.type);
          if (data.type === "error") {
            console.error("OpenAI error detail:", JSON.stringify(data));
          }

          // After the session is created, send our configuration (instructions,
          // tools, audio settings, etc.) using a session.update event.
          if (data.type === "session.created") {
            const sessionUpdateEvent = {
              type: "session.update",
              session: {
                type: "realtime",
                output_modalities: ["audio"],
                instructions:
                  `You are VoxPal, a friendly construction scheduling assistant. Your job is to help superintendents create accurate task schedules through natural conversation.

${MECHANICAL_SCHEDULING_GUIDANCE}

When a user wants to add a task, ask them about:
1. Task name/description (what needs to be done)
2. Trade type (electrical, mechanical, plumbing, structural, concrete, demolition, etc.)
3. Number of workers needed
4. Equipment needed (be specific about quantities and types)
5. Duration in days
6. Any special notes

Be conversational and casual - you're talking to superintendents who know the job but might not be tech-savvy.

Listening rules (important):
- Always let the speaker finish. Never talk over them or start answering mid-sentence. If you hear a pause, wait a moment in case they are still thinking.
- Never guess or invent what was said. If audio was unclear, partial, or you are not confident, say something short like "Sorry, I didn't catch that - say it again?" instead of assuming.
- Never put words in their mouth: only use details they actually said. Do not fill in task names, trades, counts, or durations they never gave you.

Ask one or two questions at a time, don't overwhelm them. If they give you partial info, ask follow-up questions naturally like "Got it, and how many workers do you need for that?" or "What equipment will they need?"

Once you have all the required info, give a brief one-sentence confirmation (e.g. "Alright, I'll add that concrete pour with 5 workers") and immediately create the task. Don't repeat all the details back multiple times - they just told you, they know what they said. Use the create_task function right away once you have the info.

Be encouraging and helpful. If they're unsure about something, offer suggestions based on common construction practices.`,

                audio: {
                  input: {
                    format: { type: "audio/pcm", rate: 24000 },
                    transcription: {
                      model: "gpt-4o-transcribe",
                      language: "en",
                      prompt:
                        "Construction jobsite scheduling terms: rebar, formwork, shoring, footings, slab on grade, rough-in, excavation, backfill, MEP, asbestos abatement, demolition, crew, superintendent, pipefitter, millwright, process piping, isometric, P&ID, spool, flange, valve, rigging, NDE, PWHT, hydrotest, LOTO, pump alignment, commissioning.",
                    },
                    noise_reduction: { type: "near_field" },
                    turn_detection: {
                      type: "semantic_vad",
                      eagerness: "low",
                      interrupt_response: false,
                    },
                  },
                  output: {
                    format: { type: "audio/pcm", rate: 24000 },
                    voice: "alloy",
                  },
                },

                tools: [
                  {
                    type: "function",
                    name: "create_task",
                    description:
                      "Create a construction task with all required details. Only call this after confirming all details with the user.",
                    parameters: {
                      type: "object",
                      properties: {
                        name: {
                          type: "string",
                          description: "Task name/description",
                        },
                        trade: {
                          type: "string",
                          enum: [
                            "electrical",
                            "mechanical",
                            "plumbing",
                            "structural",
                            "finishes",
                            "general",
                            "asbestos_abatement",
                            "demolition",
                            "concrete_construction",
                            "concrete_pour",
                            "concrete_cutting",
                            "concrete_grinding",
                            "concrete_finishing",
                            "rebar",
                            "formwork",
                            "civil",
                          ],
                          description: "Trade category",
                        },
                        manpower: {
                          type: "number",
                          description: "Number of workers needed",
                        },
                        equipment: {
                          type: "string",
                          description:
                            "Equipment needed with quantities (e.g., '2 excavators, 1 dump truck')",
                        },
                        duration: {
                          type: "number",
                          description: "Duration in days",
                        },
                        notes: {
                          type: "string",
                          description:
                            "Additional notes or special requirements",
                        },
                      },
                      required: [
                        "name",
                        "trade",
                        "manpower",
                        "equipment",
                        "duration",
                      ],
                    },
                  },
                ],
                tool_choice: "auto",
                max_output_tokens: 4096,
              },
            };

            console.log("Sending session.update to OpenAI");
            openAISocket?.send(JSON.stringify(sessionUpdateEvent));
          }

          // Forward all events to client
          socket.send(event.data);
        } catch (error) {
          console.error("Error processing OpenAI message:", error);
        }
      };

      openAISocket.onerror = (error) => {
        console.error("OpenAI WebSocket error:", error);
        socket.send(
          JSON.stringify({
            type: "error",
            error: "OpenAI connection error",
          }),
        );
      };

      openAISocket.onclose = () => {
        console.log("OpenAI WebSocket closed");
        socket.close();
      };
    } catch (error) {
      console.error("Error connecting to OpenAI:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      socket.send(
        JSON.stringify({
          type: "error",
          error: `Failed to connect to VoxPal: ${errorMessage}`,
        }),
      );
      socket.close();
    }
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log("Client event type:", data.type);
      
      // Forward client messages to OpenAI
      if (openAISocket?.readyState === WebSocket.OPEN) {
        openAISocket.send(event.data);
      }
    } catch (error) {
      console.error("Error processing client message:", error);
    }
  };

  socket.onerror = (error) => {
    console.error("Client WebSocket error:", error);
  };

  socket.onclose = () => {
    console.log("Client disconnected from VoxPal");
    openAISocket?.close();
  };

  return response;
});
