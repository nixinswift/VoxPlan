import { Mic, MicOff, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useVoxPal } from "@/hooks/useVoxPal";
import { useIsMobile } from "@/hooks/use-mobile";

interface VoiceInputButtonProps {
  onTaskCreated?: (taskData: any) => void;
  size?: "default" | "sm" | "lg" | "icon";
}

export const VoiceInputButton = ({ onTaskCreated, size = "default" }: VoiceInputButtonProps) => {
  const isMobile = useIsMobile();
  const {
    isConnected,
    isSpeaking,
    isListening,
    messages,
    transcript,
    startConversation,
    endConversation,
  } = useVoxPal({ onTaskCreated });

  const content = (
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
        <div className="space-y-2 max-h-[350px] overflow-y-auto">
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
  );

  return (
    <>
      <Button
        type="button"
        onClick={isConnected ? endConversation : startConversation}
        size={size}
        variant={isConnected ? "destructive" : "default"}
        className={isListening ? "animate-pulse" : ""}
      >
        {isConnected ? (
          <>
            <MicOff className="mr-2 h-5 w-5" />
            End VoxPal
          </>
        ) : (
          <>
            <Volume2 className="mr-2 h-5 w-5" />
            Talk to VoxPal
          </>
        )}
      </Button>

      {isMobile ? (
        <Drawer open={isConnected}>
          <DrawerContent className="max-h-[85vh]" onPointerDownOutside={(e) => e.preventDefault()}>
            <DrawerHeader>
              <DrawerTitle className="flex items-center gap-2">
                <Volume2 className="h-5 w-5" />
                VoxPal - Voice Assistant
              </DrawerTitle>
              <DrawerDescription>
                Speak naturally to create tasks. Press "End VoxPal" when done.
              </DrawerDescription>
            </DrawerHeader>
            <div className="px-4 pb-6 overflow-y-auto">
              {content}
              <Button 
                onClick={endConversation} 
                variant="destructive" 
                className="w-full mt-4"
              >
                <MicOff className="mr-2 h-4 w-4" />
                End VoxPal
              </Button>
            </div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={isConnected}>
          <DialogContent 
            className="max-w-2xl max-h-[600px] overflow-y-auto" 
            onPointerDownOutside={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => e.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Volume2 className="h-5 w-5" />
                VoxPal - Voice Assistant
              </DialogTitle>
              <DialogDescription>
                Speak naturally to create tasks. Press "End VoxPal" when done.
              </DialogDescription>
            </DialogHeader>
            {content}
            <Button 
              onClick={endConversation} 
              variant="destructive" 
              className="w-full mt-4"
            >
              <MicOff className="mr-2 h-4 w-4" />
              End VoxPal
            </Button>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};
