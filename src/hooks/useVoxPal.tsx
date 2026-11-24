import { useState, useRef, useEffect } from "react";
import { toast } from "@/hooks/use-toast";
import { AudioRecorder, AudioQueue, encodeAudioForAPI, createWavFromPCM } from "@/utils/VoxPalAudio";
import { TaskCreationRequests, runOnce } from "@/lib/taskCreation";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface UseVoxPalProps {
  onTaskCreated?: (taskData: any) => void | Promise<void>;
}

export const useVoxPal = ({ onTaskCreated }: UseVoxPalProps = {}) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [transcript, setTranscript] = useState("");
  
  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<AudioQueue | null>(null);
  // While VoxPal is speaking we stop uploading mic audio so its own voice
  // (picked up by the speakers) can't be transcribed as the user talking.
  const assistantSpeakingRef = useRef(false);
  const speakingTailTimerRef = useRef<number | null>(null);
  const creationIds = useRef(new TaskCreationRequests());
  const toolWrites = useRef(new Map<string, Promise<void>>());

  const markAssistantSpeaking = () => {
    assistantSpeakingRef.current = true;
    if (speakingTailTimerRef.current) window.clearTimeout(speakingTailTimerRef.current);
  };

  const markAssistantDone = () => {
    if (speakingTailTimerRef.current) window.clearTimeout(speakingTailTimerRef.current);
    // small tail so the last of the playback isn't captured
    speakingTailTimerRef.current = window.setTimeout(() => {
      assistantSpeakingRef.current = false;
    }, 400);
  };


  const getWebSocketUrl = () => {
    const projectRef = "aomrjtxkdtziixuqoiei";
    return `wss://${projectRef}.supabase.co/functions/v1/voxpal-realtime`;
  };

  const startConversation = async () => {
    try {
      // Request microphone permission first
      await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // On mobile, AudioContext needs to be created after user interaction
      // and may need to be resumed
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioContextClass({ sampleRate: 24000 });
      
      // Resume audio context if it's suspended (common on mobile)
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      
      audioQueueRef.current = new AudioQueue(audioContextRef.current);

      const wsUrl = getWebSocketUrl();
      console.log("Connecting to VoxPal at:", wsUrl);
      
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = async () => {
        console.log("Connected to VoxPal");
        setIsConnected(true);
        
        recorderRef.current = new AudioRecorder((audioData) => {
          if (assistantSpeakingRef.current) return;
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            const encoded = encodeAudioForAPI(audioData);
            wsRef.current.send(JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: encoded
            }));
          }
        });

        
        await recorderRef.current.start();
        setIsListening(true);
        
        toast({
          title: "VoxPal Connected",
          description: "Start speaking to add a task. VoxPal will guide you through the process.",
        });
      };

      wsRef.current.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("VoxPal event:", data.type);

          switch (data.type) {
            case 'session.created':
              console.log("Session created");
              break;

            case 'session.updated':
              console.log("Session updated");
              break;

            case 'response.output_audio.delta':
            case 'response.audio.delta':
              if (data.delta && audioQueueRef.current) {
                markAssistantSpeaking();
                const binaryString = atob(data.delta);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                  bytes[i] = binaryString.charCodeAt(i);
                }
                await audioQueueRef.current.addToQueue(bytes);
                setIsSpeaking(true);
              }
              break;

            case 'response.output_audio.done':
            case 'response.audio.done':
              markAssistantDone();
              setIsSpeaking(false);
              break;



            case 'conversation.item.input_audio_transcription.completed':
              if (data.transcript) {
                setTranscript(data.transcript);
                setMessages(prev => [...prev, { role: "user", content: data.transcript }]);
              }
              break;

            case 'response.output_audio_transcript.delta':
            case 'response.audio_transcript.delta':
              if (data.delta) {
                setTranscript(prev => prev + data.delta);
              }
              break;

            case 'response.output_audio_transcript.done':
            case 'response.audio_transcript.done':
              if (data.transcript) {
                setMessages(prev => {
                  const lastMessage = prev[prev.length - 1];
                  if (lastMessage?.role === "assistant") {
                    return [...prev.slice(0, -1), { role: "assistant", content: data.transcript }];
                  }
                  return [...prev, { role: "assistant", content: data.transcript }];
                });
              }
              setTranscript("");
              break;

            case 'response.function_call_arguments.done':
              console.log("Function call:", data.name, data.arguments);
              if (data.name === "create_task") {
                const taskData = JSON.parse(data.arguments);
                if (!data.call_id || !onTaskCreated) throw new Error("Missing task creation identity or save handler.");
                const id = creationIds.current.idFor(data.call_id);
                let output: { success: boolean; message: string };
                try {
                  await runOnce(toolWrites.current, id, async () => { await onTaskCreated({ ...taskData, creationId: id }); });
                  output = { success: true, message: "Task saved successfully." };
                } catch {
                  output = { success: false, message: "Task was not saved. Retry the same task creation." };
                  toast({ title: "Task not saved", description: output.message, variant: "destructive" });
                }
                
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({
                    type: 'conversation.item.create',
                    item: {
                      type: 'function_call_output',
                      call_id: data.call_id,
                      output: JSON.stringify(output)
                    }
                  }));
                }
              }
              break;

            case 'error':
              console.error("VoxPal error:", data.error);
              const errorMessage = typeof data.error === 'string' 
                ? data.error 
                : data.error?.message || JSON.stringify(data.error);
              toast({
                title: "VoxPal Error",
                description: errorMessage,
                variant: "destructive",
              });
              break;
          }
        } catch (error) {
          console.error("Error processing message:", error);
        }
      };

      wsRef.current.onerror = (error) => {
        console.error("WebSocket error:", error);
        toast({
          title: "Connection Error",
          description: "Failed to connect to VoxPal",
          variant: "destructive",
        });
      };

      wsRef.current.onclose = () => {
        console.log("WebSocket closed");
        setIsConnected(false);
        setIsListening(false);
        setIsSpeaking(false);
        recorderRef.current?.stop();
      };

    } catch (error) {
      console.error("Error starting conversation:", error);
      toast({
        title: "Microphone Error",
        description: "Please allow microphone access to use VoxPal",
        variant: "destructive",
      });
    }
  };

  const endConversation = () => {
    recorderRef.current?.stop();
    wsRef.current?.close();
    audioQueueRef.current?.clear();
    audioContextRef.current?.close();
    
    setIsConnected(false);
    setIsListening(false);
    setIsSpeaking(false);
    setMessages([]);
    setTranscript("");
    
    toast({
      title: "VoxPal Disconnected",
      description: "Conversation ended",
    });
  };

  useEffect(() => {
    return () => {
      if (isConnected) {
        endConversation();
      }
    };
  }, []);

  return {
    isConnected,
    isSpeaking,
    isListening,
    messages,
    transcript,
    startConversation,
    endConversation,
  };
};
