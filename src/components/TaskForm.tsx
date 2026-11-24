import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { VoiceInputButton } from "./VoiceInputButton";
import { Task, TradeType } from "@/types/schedule";
import { Plus, CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";

interface TaskFormProps {
  onAddTask: (task: Omit<Task, "id">) => void | Promise<void>;
  onUpdateTask?: (id: string, task: Omit<Task, "id">) => void | Promise<void>;
  editingTask?: Task | null;
  onCancelEdit?: () => void;
  lastTaskDate?: Date;
  existingTasks: Task[];
  onVoiceTaskCreated: (taskData: any) => void;
}

export const TaskForm = ({ onAddTask, onUpdateTask, editingTask, onCancelEdit, lastTaskDate, existingTasks, onVoiceTaskCreated }: TaskFormProps) => {
  const [name, setName] = useState("");
  const [trade, setTrade] = useState<TradeType>("general");
  const [manpower, setManpower] = useState<number>(1);
  const [equipment, setEquipment] = useState("");
  const [duration, setDuration] = useState<number>(1);
  const [parentId, setParentId] = useState<string>("none");
  const [predecessorIds, setPredecessorIds] = useState<string[]>([]);
  const submitting = useRef(false);
  const requestId = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  
  const getDefaultStartDate = () => {
    if (lastTaskDate) {
      const nextDate = new Date(lastTaskDate);
      nextDate.setDate(nextDate.getDate() + 5);
      return nextDate;
    }
    return new Date();
  };
  
  const [startDate, setStartDate] = useState<Date>(getDefaultStartDate());

  useEffect(() => {
    setStartDate(getDefaultStartDate());
  }, [lastTaskDate]);

  // Populate form when editing
  useEffect(() => {
    if (editingTask) {
      setName(editingTask.name);
      setTrade(editingTask.trade);
      setManpower(editingTask.manpower);
      setEquipment(editingTask.equipment);
      setDuration(editingTask.duration);
      setStartDate(editingTask.startDate);
      setParentId(editingTask.parentId || "none");
      setPredecessorIds(editingTask.predecessorIds ?? []);
    }
  }, [editingTask]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    requestId.current ??= crypto.randomUUID();
    
    const task: Omit<Task, "id"> = {
      creationId: requestId.current,
      name: name || trade.charAt(0).toUpperCase() + trade.slice(1),
      trade,
      manpower,
      equipment,
      duration,
      startDate: startDate,
      parentId: parentId !== "none" ? parentId : undefined,
      predecessorIds,
    };

    try {
    if (editingTask && onUpdateTask) {
      await onUpdateTask(editingTask.id, task);
    } else {
      await onAddTask(task);
    }
    requestId.current = null;
    
    // Reset form
    setName("");
    setTrade("general");
    setManpower(1);
    setEquipment("");
    setDuration(1);
    setParentId("none");
    setPredecessorIds([]);
    setStartDate(getDefaultStartDate());
    
    if (onCancelEdit) {
      onCancelEdit();
    }
    } catch { /* Keep the submitted fields and identity available for retry. */ }
    finally { submitting.current = false; setSaving(false); }
  };

  return (
    <Card>
      <CardHeader>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <CardTitle>{editingTask ? 'Edit Task' : 'Add Task'}</CardTitle>
            <div className="flex items-center gap-2">
              {editingTask && onCancelEdit && (
                <Button type="button" variant="outline" size="sm" onClick={onCancelEdit}>
                  Cancel
                </Button>
              )}
              <VoiceInputButton
                onTaskCreated={onVoiceTaskCreated}
                size="sm"
              />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            🎤 Voice: Talk to VoxPal - it'll guide you through creating a task conversationally
          </p>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="parentTask">Parent Task (Optional)</Label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger id="parentTask">
                  <SelectValue placeholder="None - Top Level Task" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None - Top Level Task</SelectItem>
                  {existingTasks
                    .filter((t) => !t.parentId && t.id !== editingTask?.id) // Only show top-level tasks, exclude self
                    .map((task) => (
                      <SelectItem key={task.id} value={task.id}>
                        {task.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Task Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Flooring Install"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="trade">Trade</Label>
              <Select value={trade} onValueChange={(v) => setTrade(v as TradeType)}>
                <SelectTrigger id="trade">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="electrical">Electrical</SelectItem>
                  <SelectItem value="mechanical">Mechanical</SelectItem>
                  <SelectItem value="plumbing">Plumbing</SelectItem>
                  <SelectItem value="structural">Structural</SelectItem>
                  <SelectItem value="finishes">Finishes</SelectItem>
                  <SelectItem value="general">General</SelectItem>
                  <SelectItem value="asbestos_abatement">Asbestos Abatement</SelectItem>
                  <SelectItem value="demolition">Demolition</SelectItem>
                  <SelectItem value="concrete_construction">Concrete Construction</SelectItem>
                  <SelectItem value="concrete_pour">Concrete Pour</SelectItem>
                  <SelectItem value="concrete_cutting">Concrete Cutting</SelectItem>
                  <SelectItem value="concrete_grinding">Concrete Grinding</SelectItem>
                  <SelectItem value="concrete_finishing">Concrete Finishing</SelectItem>
                  <SelectItem value="rebar">Rebar</SelectItem>
                  <SelectItem value="formwork">Formwork</SelectItem>
                  <SelectItem value="civil">Civil</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="manpower">Manpower</Label>
              <Input
                id="manpower"
                type="number"
                min="1"
                value={manpower}
                onChange={(e) => setManpower(parseInt(e.target.value) || 1)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="equipment">Equipment</Label>
              <Input
                id="equipment"
                value={equipment}
                onChange={(e) => setEquipment(e.target.value)}
                placeholder="e.g., 2 lifts, 1 JLG"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="duration">Duration (days)</Label>
              <Input
                id="duration"
                type="number"
                min="1"
                value={duration}
                onChange={(e) => setDuration(parseInt(e.target.value) || 1)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="startDate">Start Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    id="startDate"
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !startDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate ? format(startDate, "PPP") : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={(date) => date && setStartDate(date)}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <Button type="submit" disabled={saving} className="w-full">
            <Plus className="mr-2 h-4 w-4" />
            {editingTask ? 'Update Task' : 'Add Task'}
          </Button>
          {existingTasks.length > 0 && <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Must finish before this task starts</legend>
            {existingTasks.filter(task => task.id !== editingTask?.id).map(task => <label key={task.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={predecessorIds.includes(task.id)} onCheckedChange={checked => setPredecessorIds(ids => checked ? [...ids, task.id] : ids.filter(id => id !== task.id))} />
              {task.name}
            </label>)}
          </fieldset>}
        </form>
      </CardContent>
    </Card>
  );
};
