import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mic, MicOff, Volume2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { AudioRecorder, AudioQueue, encodeAudioForAPI, createWavFromPCM } from "@/utils/VoxPalAudio";
import { supabase } from "@/integrations/supabase/client";

interface VoxPalProps {
  onTaskCreated?: (taskData: any) => void;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

export const VoxPal = ({ onTaskCreated }: VoxPalProps) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [transcript, setTranscript] = useState("");
  
  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<AudioQueue | null>(null);

  const getWebSocketUrl = () => {
    const projectRef = "aomrjtxkdtziixuqoiei";
    return `wss://${projectRef}.supabase.co/functions/v1/voxpal-realtime`;
  };

  const startConversation = async () => {
    try {
      // Request microphone permission
      await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Initialize audio context
      audioContextRef.current = new AudioContext({ sampleRate: 24000 });
      audioQueueRef.current = new AudioQueue(audioContextRef.current);

      // Connect to WebSocket
      const wsUrl = getWebSocketUrl();
      console.log("Connecting to VoxPal at:", wsUrl);
      
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = async () => {
        console.log("Connected to VoxPal");
        setIsConnected(true);
        
        // Start recording
        recorderRef.current = new AudioRecorder((audioData) => {
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
                onTaskCreated?.(taskData);
                
                // Send confirmation back
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({
                    type: 'conversation.item.create',
                    item: {
                      type: 'function_call_output',
                      call_id: data.call_id,
                      output: JSON.stringify({ success: true, message: "Task created successfully!" })
                    }
                  }));
                }
              }
              break;

            case 'error':
              console.error("VoxPal error:", data.error);
              toast({
                title: "VoxPal Error",
                description: data.error,
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

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Volume2 className="h-5 w-5" />
              VoxPal - Voice Assistant
            </CardTitle>
            <CardDescription>
              Talk naturally with VoxPal to create tasks. It'll ask questions to make sure nothing is missed.
            </CardDescription>
          </div>
          {!isConnected ? (
            <Button onClick={startConversation} className="gap-2">
              <Mic className="h-4 w-4" />
              Start Talking
            </Button>
          ) : (
            <Button onClick={endConversation} variant="destructive" className="gap-2">
              <MicOff className="h-4 w-4" />
              End Session
            </Button>
          )}
        </div>
      </CardHeader>
      
      {isConnected && (
        <CardContent>
          <div className="space-y-4">
            {/* Status indicators */}
            <div className="flex gap-4 text-sm">
              <div className={`flex items-center gap-2 ${isListening ? 'text-green-500' : 'text-muted-foreground'}`}>
                <div className={`h-2 w-2 rounded-full ${isListening ? 'bg-green-500 animate-pulse' : 'bg-muted'}`} />
                Listening
              </div>
              <div className={`flex items-center gap-2 ${isSpeaking ? 'text-blue-500' : 'text-muted-foreground'}`}>
                <div className={`h-2 w-2 rounded-full ${isSpeaking ? 'bg-blue-500 animate-pulse' : 'bg-muted'}`} />
                VoxPal Speaking
              </div>
            </div>

            {/* Live transcript */}
            {transcript && (
              <div className="p-3 bg-muted rounded-md">
                <p className="text-sm text-muted-foreground italic">{transcript}</p>
              </div>
            )}

            {/* Conversation history */}
            {messages.length > 0 && (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-md ${
                      msg.role === "user"
                        ? "bg-primary/10 ml-8"
                        : "bg-muted mr-8"
                    }`}
                  >
                    <p className="text-sm font-medium mb-1">
                      {msg.role === "user" ? "You" : "VoxPal"}
                    </p>
                    <p className="text-sm">{msg.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
};
