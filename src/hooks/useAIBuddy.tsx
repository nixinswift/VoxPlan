import { useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { SchedulingToolStream } from "@/lib/schedulingToolStream";
import { TaskCreationRequests, creationRowKey } from "@/lib/taskCreation";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface TaskData {
  creationId?: string;
  name: string;
  trade: string;
  manpower: number;
  equipment: string;
  duration: number;
  sequenceOrder?: number;
}

interface AIBuddyOptions {
  tasks?: { id: string; name: string; trade: string; manpower: number; equipment?: string; duration: number; startDate: Date }[];
  onTaskUpdated?: (id: string, updates: Record<string, unknown>) => void | Promise<void>;
}

export const useAIBuddy = (
  onTaskCreated?: (task: TaskData) => void | Promise<void>,
  options?: AIBuddyOptions
) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const sending = useRef(false);

  const sendMessage = async (userMessage: string) => {
    if (sending.current || !userMessage.trim()) return;
    sending.current = true;
    const newUserMessage: Message = { role: "user", content: userMessage };
    setMessages(prev => [...prev, newUserMessage]);
    setIsLoading(true);

    let assistantMessage = "";
    const toolStream = new SchedulingToolStream();
    const requestId = crypto.randomUUID();
    const creationIds = new TaskCreationRequests();
    const createdRows = new Set<string>();

    try {
      const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-scheduling-buddy`;
      
      const response = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: [...messages, newUserMessage],
          today: new Date().toISOString().split("T")[0],
          scheduleContext: (options?.tasks ?? []).map(t => {
            const end = new Date(t.startDate);
            end.setDate(end.getDate() + Math.max(1, t.duration) - 1);
            return {
              id: t.id,
              name: t.name,
              trade: t.trade,
              manpower: t.manpower,
              equipment: t.equipment ?? "",
              duration: t.duration,
              startDate: new Date(t.startDate).toISOString().split("T")[0],
              endDate: end.toISOString().split("T")[0],
            };
          }),
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error('Failed to start stream');
      }

      const reader = response.body.getReader();
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
            const delta = parsed.choices?.[0]?.delta;
            
            if (delta?.content) {
              assistantMessage += delta.content;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  return prev.map((m, i) => 
                    i === prev.length - 1 ? { ...m, content: assistantMessage } : m
                  );
                }
                return [...prev, { role: "assistant", content: assistantMessage }];
              });
            }

            // Handle tool calls
            if (delta?.tool_calls) toolStream.append(delta.tool_calls);

            // Check if tool call is complete
            if (parsed.choices?.[0]?.finish_reason === "tool_calls") {
              for (const call of toolStream.consume()) {
              try {
                const args = JSON.parse(call.arguments);
                
                if (call.name === "create_multiple_tasks" && args.tasks) {
                  // Handle multiple tasks - sort by sequenceOrder to ensure correct date calculation
                  const sortedTasks = [...args.tasks].sort((a: TaskData, b: TaskData) => 
                    (a.sequenceOrder ?? 0) - (b.sequenceOrder ?? 0)
                  );
                  console.log('Multiple tasks created by AI buddy (sequenced):', sortedTasks);
                  const taskCount = sortedTasks.length;
                  
                  if (onTaskCreated) {
                    for (const [index, task] of sortedTasks.entries()) {
                      const key = creationRowKey(task);
                      if (createdRows.has(key)) continue;
                      createdRows.add(key);
                      // Pass sequence info so dates can be calculated cumulatively
                      await onTaskCreated({ ...task, sequenceOrder: index, creationId: creationIds.idFor(`${requestId}/${call.id}/${index}`) });
                    }
                  }
                  
                  const confirmMsg = `✓ ${taskCount} tasks scheduled in sequence! Added to your board.`;
                  assistantMessage += (assistantMessage ? " " : "") + confirmMsg;
                } else if (call.name === "update_task" && args.id) {
                  const updates: Record<string, unknown> = {};
                  if (args.name !== undefined) updates.name = args.name;
                  if (args.manpower !== undefined) updates.manpower = args.manpower;
                  if (args.equipment !== undefined) updates.equipment = args.equipment;
                  if (args.duration !== undefined) updates.duration = args.duration;
                  if (args.startDate) updates.startDate = new Date(`${args.startDate}T00:00:00`);

                  await options?.onTaskUpdated?.(args.id, updates);
                  assistantMessage += (assistantMessage ? " " : "") + "\u2713 Schedule updated.";
                } else if (call.name === "create_task") {
                  // Handle single task
                  console.log('Task created by AI buddy:', args);
                  
                  if (onTaskCreated) {
                    const key = creationRowKey(args);
                    if (createdRows.has(key)) continue;
                    createdRows.add(key);
                    await onTaskCreated({ ...args, creationId: creationIds.idFor(`${requestId}/${key}`) });
                  }
                  
                  const confirmMsg = "✓ Task scheduled! Added to your board.";
                  assistantMessage += (assistantMessage ? " " : "") + confirmMsg;
                }
                
                setMessages(prev => {
                  const last = prev[prev.length - 1];
                  if (last?.role === "assistant") {
                    return prev.map((m, i) => 
                      i === prev.length - 1 ? { ...m, content: assistantMessage } : m
                    );
                  }
                  return [...prev, { role: "assistant", content: assistantMessage }];
                });
              } catch (e) {
                console.error('Scheduling action failed:', e);
                toast({ title: "Task not saved", description: "The scheduling action failed. Please retry.", variant: "destructive" });
              }
              }
            }
          } catch (e) {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      toast({
        title: "Chat error",
        description: "Couldn't reach VoxPlan. Try again.",
        variant: "destructive",
      });
      setMessages(prev => prev.slice(0, -1));
    } finally {
      sending.current = false;
      setIsLoading(false);
    }
  };

  const clearChat = () => setMessages([]);

  return { messages, isLoading, sendMessage, clearChat };
};
