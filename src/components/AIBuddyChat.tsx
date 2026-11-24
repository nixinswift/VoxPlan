import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageCircle, Send, Mic, X } from "lucide-react";
import { useAIBuddy } from "@/hooks/useAIBuddy";
import { useVoiceInput } from "@/hooks/useVoiceInput";

interface AIBuddyChatProps {
  onTaskCreated?: (task: any) => void;
  tasks?: any[];
  onTaskUpdated?: (id: string, updates: any) => void;
}

export const AIBuddyChat = ({ onTaskCreated, tasks, onTaskUpdated }: AIBuddyChatProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputText, setInputText] = useState("");
  const { messages, isLoading, sendMessage, clearChat } = useAIBuddy(onTaskCreated, { tasks, onTaskUpdated });
  const { isListening, transcript, startListening, stopListening, clearTranscript } = useVoiceInput("ai-buddy");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const processedTranscriptRef = useRef<string>("");

  useEffect(() => {
    // Only process when listening stops AND transcript is different from last processed
    if (!isListening && transcript && transcript.trim().length > 0) {
      if (transcript !== processedTranscriptRef.current) {
        console.log('AI Buddy: Setting input text:', transcript);
        setInputText(transcript);
        processedTranscriptRef.current = transcript;
        clearTranscript();
      }
    }
  }, [isListening, transcript, clearTranscript]);

  const handleSend = async () => {
    if (!inputText.trim() || isLoading) return;
    
    const message = inputText;
    setInputText("");
    await sendMessage(message);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        size="lg"
        className="fixed bottom-6 right-6 rounded-full h-16 w-16 shadow-lg"
      >
        <MessageCircle className="h-6 w-6" />
      </Button>
    );
  }

  return (
    <Card className="fixed bottom-4 right-2 left-2 sm:left-auto sm:bottom-6 sm:right-6 sm:w-96 h-[70vh] max-h-[600px] z-50 shadow-2xl flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 border-b">
        <CardTitle className="text-lg font-semibold">🏗️ Scheduling Buddy</CardTitle>
        <div className="flex gap-2">
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearChat}>
              Clear
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 flex flex-col p-4 min-h-0">
        <div
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-2"
          style={{ WebkitOverflowScrolling: "touch" }}
          ref={scrollRef}
        >
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground p-8">
              <MessageCircle className="h-12 w-12 mb-4 opacity-50" />
              <p className="text-sm">
                Hey! I'm your scheduling buddy. Tell me what you need to get done and I'll help you schedule it.
              </p>
              <p className="text-xs mt-2">
                Try: "Extend asbestos to the 29th" or "Why is there nothing Sept 7-12?"
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-2 ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-lg px-3 py-2">
                    <p className="text-sm text-muted-foreground animate-pulse">...</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-4 pt-4 border-t">
          <Button
            variant={isListening ? "destructive" : "outline"}
            size="icon"
            onClick={isListening ? stopListening : startListening}
            disabled={isLoading}
          >
            <Mic className={`h-4 w-4 ${isListening ? 'animate-pulse' : ''}`} />
          </Button>
          <Input
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type or speak your message..."
            disabled={isLoading || isListening}
            className="flex-1"
          />
          <Button 
            onClick={handleSend} 
            disabled={!inputText.trim() || isLoading}
            size="icon"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        
        {isListening && (
          <p className="text-xs text-muted-foreground text-center mt-2">
            🎤 {transcript || "Listening..."}
          </p>
        )}
      </CardContent>
    </Card>
  );
};
