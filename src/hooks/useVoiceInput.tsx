import { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "@/hooks/use-toast";
import { TradeType } from "@/types/schedule";
import { supabase } from "@/integrations/supabase/client";
import { useVoiceContext } from "@/contexts/VoiceContext";

interface ParsedVoiceInput {
  name?: string;
  trade?: TradeType;
  manpower?: number;
  equipment?: string;
  duration?: number;
}

export const useVoiceInput = (voiceId: string) => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const { activeVoiceId, setActiveVoiceId } = useVoiceContext();

  const parseVoiceInput = async (text: string): Promise<ParsedVoiceInput> => {
    setIsParsing(true);
    try {
      console.log('Sending transcript to AI:', text);
      
      const { data, error } = await supabase.functions.invoke('parse-voice-input', {
        body: { transcript: text }
      });

      if (error) {
        console.error('Edge function error:', error);
        
        // Check for rate limiting
        if (error.message?.includes('429') || data?.rateLimited) {
          toast({
            title: "Rate limit reached",
            description: "Too many requests. Please wait a minute and try again, or use the manual form.",
            variant: "destructive",
            duration: 5000,
          });
          return {};
        }
        
        throw error;
      }

      console.log('AI parsed result:', data);
      return data as ParsedVoiceInput;
    } catch (error) {
      console.error('Failed to parse voice input:', error);
      toast({
        title: "Parsing failed",
        description: "Couldn't understand the input. Try again or use the form.",
        variant: "destructive",
      });
      return {};
    } finally {
      setIsParsing(false);
    }
  };

  const startListening = useCallback(async () => {
    // Stop any other active voice input
    if (activeVoiceId && activeVoiceId !== voiceId) {
      toast({
        title: "Voice input in use",
        description: "Stop the other voice input first.",
        variant: "destructive",
        duration: 2000,
      });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        console.log('Recording stopped, processing audio...');
        
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        
        // Convert to base64
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Audio = (reader.result as string).split(',')[1];
          
          setIsParsing(true);
          setTranscript("Transcribing...");
          
          try {
            const { data, error } = await supabase.functions.invoke('transcribe-audio', {
              body: { audio: base64Audio }
            });

            if (error) throw error;

            const transcribedText = data.text;
            console.log('Transcribed:', transcribedText);
            setTranscript(transcribedText);
            
            toast({
              title: "Transcription complete",
              description: "Processing your task...",
              duration: 2000,
            });
          } catch (error) {
            console.error('Transcription error:', error);
            toast({
              title: "Error",
              description: "Failed to transcribe audio",
              variant: "destructive",
            });
            setTranscript("");
          } finally {
            setIsParsing(false);
            setIsListening(false);
            if (activeVoiceId === voiceId) {
              setActiveVoiceId(null);
            }
          }
        };

        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setTranscript("");
      setActiveVoiceId(voiceId);
      setIsListening(true);
      
      toast({
        title: "🎤 Recording...",
        description: "Speak your task details. Click Stop when done.",
        duration: 2000,
      });

    } catch (error) {
      console.error('Failed to start recording:', error);
      toast({
        title: "Error",
        description: "Failed to access microphone. Check your browser permissions.",
        variant: "destructive",
      });
    }
  }, [voiceId, activeVoiceId, setActiveVoiceId]);

  const stopListening = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      // Note: isListening is set to false in the onstop handler after transcription
    }
  }, [voiceId, activeVoiceId, setActiveVoiceId]);

  return {
    isListening,
    transcript,
    isParsing,
    startListening,
    stopListening,
    parseVoiceInput,
    clearTranscript: () => setTranscript(""),
  };
};
