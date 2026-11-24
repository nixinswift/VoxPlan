import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Upload, Send, X, Trash2, Loader2, BookOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";

interface SpecFile {
  id: string;
  file_name: string;
  file_path: string;
  extracted_text: string;
  created_at: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface SpecsChatProps {
  projectId: string;
}

export const SpecsChat = ({ projectId }: SpecsChatProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [specs, setSpecs] = useState<SpecFile[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadSpecs = useCallback(async () => {
    const { data, error } = await supabase
      .from("project_specs")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setSpecs(data as SpecFile[]);
    }
  }, [projectId]);

  useEffect(() => {
    if (isOpen) loadSpecs();
  }, [isOpen, loadSpecs]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);

    for (const file of Array.from(files)) {
      try {
        const filePath = `${projectId}/${Date.now()}-${file.name}`;

        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from("project-specs")
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        // Get user
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");

        // Create spec record
        const { data: specRecord, error: insertError } = await supabase
          .from("project_specs")
          .insert({
            project_id: projectId,
            user_id: user.id,
            file_name: file.name,
            file_path: filePath,
            file_type: file.type,
          })
          .select()
          .single();

        if (insertError) throw insertError;

        toast({
          title: "Uploading & Processing",
          description: `Extracting text from ${file.name}...`,
        });

        // Trigger text extraction
        const { error: extractError } = await supabase.functions.invoke("extract-spec-text", {
          body: {
            specId: specRecord.id,
            filePath,
            fileType: file.type,
          },
        });

        if (extractError) {
          console.error("Extraction error:", extractError);
          toast({
            title: "Processing Warning",
            description: `Uploaded ${file.name} but text extraction may have failed. You can still try asking questions.`,
            variant: "destructive",
          });
        } else {
          toast({
            title: "Spec Uploaded",
            description: `${file.name} is ready for questions`,
          });
        }
      } catch (err) {
        console.error("Upload error:", err);
        toast({
          title: "Upload Failed",
          description: `Failed to upload ${file.name}`,
          variant: "destructive",
        });
      }
    }

    await loadSpecs();
    setIsUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDeleteSpec = async (spec: SpecFile) => {
    try {
      await supabase.storage.from("project-specs").remove([spec.file_path]);
      await supabase.from("project_specs").delete().eq("id", spec.id);
      await loadSpecs();
      toast({ title: "Spec Removed", description: spec.file_name });
    } catch {
      toast({ title: "Error", description: "Failed to delete spec", variant: "destructive" });
    }
  };

  const handleSend = async () => {
    if (!inputText.trim() || isLoading) return;

    const question = inputText.trim();
    const userMsg: ChatMessage = { role: "user", content: question };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInputText("");
    setIsLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error("Your session expired. Please sign in again.");
      }
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/query-specs`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          projectId,
          question,
          messages: messages.slice(-10),
        }),
      });


      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || `Request failed (${resp.status})`);
      }

      // Non-streaming JSON replies (e.g. no specs uploaded / no readable text)
      const contentType = resp.headers.get("content-type") || "";
      if (!contentType.includes("text/event-stream")) {
        const data = await resp.json().catch(() => null);
        const answer = data?.answer || data?.error;
        setMessages(prev => [...prev, {
          role: "assistant",
          content: answer || "I couldn't generate a response. Please try again.",
        }]);
        return;
      }

      if (!resp.body) throw new Error("No response body");


      // Stream the response
      let assistantContent = "";
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              assistantContent += content;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  return prev.map((m, i) =>
                    i === prev.length - 1 ? { ...m, content: assistantContent } : m
                  );
                }
                return [...prev, { role: "assistant", content: assistantContent }];
              });
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }

      if (!assistantContent) {
        setMessages(prev => [...prev, { role: "assistant", content: "I couldn't generate a response. Please try again." }]);
      }
    } catch (err) {
      console.error("Query error:", err);
      const errorMsg = err instanceof Error ? err.message : "Failed to query specs";
      toast({ title: "Error", description: errorMsg, variant: "destructive" });
      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${errorMsg}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-20 right-4 z-50 rounded-full h-12 w-12 p-0 shadow-lg bg-accent text-accent-foreground hover:bg-accent/90"
        title="Specs Q&A"
      >
        <BookOpen className="h-5 w-5" />
      </Button>
    );
  }

  return (
    <Card className="fixed bottom-4 right-2 left-2 sm:left-auto sm:right-4 sm:w-[400px] z-50 shadow-2xl border-2 flex flex-col h-[70vh] max-h-[600px]">
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <BookOpen className="h-4 w-4" />
          Specs Q&A
          {specs.length > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              {specs.length} doc{specs.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </CardTitle>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowDocs(!showDocs)}>
            <FileText className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsOpen(false)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col gap-2 p-3 pt-0 min-h-0">
        {/* Document list */}
        {showDocs && (
          <div className="border rounded-md p-2 space-y-1.5 max-h-32 overflow-y-auto bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">Uploaded Specs</span>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] gap-1"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
              >
                {isUploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                Upload
              </Button>
            </div>
            {specs.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">No specs uploaded yet</p>
            ) : (
              specs.map(spec => (
                <div key={spec.id} className="flex items-center justify-between text-[11px] bg-background rounded px-2 py-1">
                  <span className="truncate flex-1">{spec.file_name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 shrink-0"
                    onClick={() => handleDeleteSpec(spec)}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              ))
            )}
          </div>
        )}

        {/* Chat messages */}
        <div
          className="flex-1 min-h-[180px] overflow-y-auto overscroll-contain"
          style={{ WebkitOverflowScrolling: "touch" }}
          ref={scrollRef}
        >
          <div className="space-y-3 pr-2">
            {messages.length === 0 && (
              <div className="text-center text-muted-foreground text-xs py-8 px-2">
                <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="font-medium">Upload specs & ask questions</p>
                <p className="mt-1">e.g. "What type of drywall is specified?" or "What's the concrete mix design?"</p>

                {specs.length === 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 gap-1.5"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                  >
                    {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    Upload Specs
                  </Button>
                )}
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none [&>p]:mb-1 [&>ul]:mb-1 [&>ol]:mb-1">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            ))}
            {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-3 py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Input */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="shrink-0 h-9 w-9"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            title="Upload spec document"
          >
            {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          </Button>
          <Input
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder="Ask about specs..."
            className="h-9 text-sm"
            disabled={isLoading}
          />
          <Button
            size="icon"
            className="shrink-0 h-9 w-9"
            onClick={handleSend}
            disabled={!inputText.trim() || isLoading}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.doc,.docx"
          multiple
          className="hidden"
          onChange={handleUpload}
        />
      </CardContent>
    </Card>
  );
};
