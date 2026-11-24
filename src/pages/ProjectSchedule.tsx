import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { User, Session } from "@supabase/supabase-js";
import { Task } from "@/types/schedule";
import { TaskForm } from "@/components/TaskForm";
import { TaskRow } from "@/components/TaskRow";
import { ResourceSummary } from "@/components/ResourceSummary";
import { GanttChart } from "@/components/GanttChart";
import { BoardView } from "@/components/BoardView";
import { toast } from "@/hooks/use-toast";
import { HardHat, List, Calendar, ArrowLeft, Kanban, BarChart3, Fuel } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AIBuddyChat } from "@/components/AIBuddyChat";
import { ManpowerAnalysis } from "@/components/ManpowerAnalysis";
import { FuelAnalysis } from "@/components/FuelAnalysis";
import { SpecsChat } from "@/components/SpecsChat";
import { ScheduleProposalExport } from "@/components/ScheduleProposalExport";
import { ScheduleUploadReview } from "@/components/ScheduleUploadReview";
import { runOnce } from "@/lib/taskCreation";


import { ChangePasswordDialog } from "@/components/ChangePasswordDialog";

const ProjectSchedule = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [project, setProject] = useState<{ name: string; description: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const creationWrites = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (!session) {
        navigate("/auth");
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
      
      if (!session) {
        navigate("/auth");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    if (user && projectId) {
      loadProject();
      loadTasks();
      
      const channel = supabase
        .channel('tasks-changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'tasks',
            filter: `project_id=eq.${projectId}`,
          },
          () => {
            loadTasks();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user, projectId]);

  const loadProject = async () => {
    if (!projectId) return;

    const { data, error } = await supabase
      .from('projects')
      .select('name, description')
      .eq('id', projectId)
      .single();

    if (error) {
      toast({
        title: "Error loading project",
        description: error.message,
        variant: "destructive",
      });
      navigate("/");
      return;
    }

    setProject(data);
  };

  const loadTasks = async () => {
    if (!projectId) return;

    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('project_id', projectId)
      .order('start_date', { ascending: true });

    if (error) {
      toast({
        title: "Error loading tasks",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    const formattedTasks: Task[] = data.map((task) => ({
      id: task.id,
      name: task.name,
      trade: task.trade as any,
      manpower: task.manpower,
      equipment: task.equipment,
      duration: task.duration,
      startDate: new Date(task.start_date),
      notes: task.notes || undefined,
      parentId: task.parent_id || undefined,
      predecessorIds: task.predecessor_ids ?? [],
    }));

    setTasks(formattedTasks);
  };

  const handleAddTask = async (task: Omit<Task, "id"> & { creationId?: string }) => {
    if (!user || !projectId) throw new Error("Sign in before saving a task.");
    const id = task.creationId ?? crypto.randomUUID();
    return runOnce(creationWrites.current, id, async () => {
    const { error } = await supabase.from("tasks").upsert({
      id,
      name: task.name,
      trade: task.trade,
      manpower: task.manpower,
      equipment: task.equipment,
      duration: task.duration,
      start_date: task.startDate.toISOString(),
      notes: task.notes,
      user_id: user.id,
      project_id: projectId,
      parent_id: task.parentId || null,
      predecessor_ids: task.predecessorIds ?? [],
    }, { onConflict: "id", ignoreDuplicates: true });

    if (error) {
      toast({
        title: "Error adding task",
        description: error.message,
        variant: "destructive",
      });
      throw error;
    }

    toast({
      title: "Task added",
      description: "Your task has been added to the schedule.",
    });

    await loadTasks();
    });
  };
  const handleImportTasks = async (newTasks: Omit<Task, "id">[]) => {
    if (!user || !projectId || newTasks.length === 0) throw new Error("Sign in and review activities before importing.");

    const { error } = await supabase.from("tasks").upsert(
      newTasks.map((task) => ({
        id: task.creationId ?? crypto.randomUUID(),
        name: task.name,
        trade: task.trade,
        manpower: task.manpower,
        equipment: task.equipment,
        duration: task.duration,
        start_date: task.startDate.toISOString(),
        notes: task.notes,
        user_id: user.id,
        project_id: projectId,
      })), { onConflict: "id", ignoreDuplicates: true }
    );

    if (error) {
      toast({ title: "Error importing schedule", description: error.message, variant: "destructive" });
      throw error;
    }

    toast({
      title: "Schedule imported",
      description: `${newTasks.length} activities added to the schedule.`,
    });

    loadTasks();
  };


  const handleEditTask = (task: Task) => {
    setEditingTask(task);
    // Scroll to form
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleUpdateTaskFromForm = async (id: string, task: Omit<Task, "id">) => {
    const updateData: any = {
      name: task.name,
      trade: task.trade,
      manpower: task.manpower,
      equipment: task.equipment,
      duration: task.duration,
      start_date: task.startDate.toISOString(),
      notes: task.notes,
      parent_id: task.parentId || null,
      predecessor_ids: task.predecessorIds ?? [],
    };

    const { error } = await supabase
      .from("tasks")
      .update(updateData)
      .eq("id", id);

    if (error) {
      toast({
        title: "Error updating task",
        description: error.message,
        variant: "destructive",
      });
      throw error;
    }

    toast({
      title: "Task updated",
      description: "The task has been updated successfully.",
    });

    setEditingTask(null);
    loadTasks();
  };

  // Track cumulative duration for sequential batch tasks
  const batchStartDateRef = useRef<Date | null>(null);
  const batchCumulativeDays = useRef<number>(0);

  const handleVoiceTaskCreated = (taskData: any) => {
    const sequenceOrder = taskData.sequenceOrder ?? -1;
    
    // If this is the first task in a batch (sequenceOrder = 0), reset tracking
    if (sequenceOrder === 0) {
      const lastTask = tasks.length > 0 
        ? tasks.reduce((latest, task) => task.startDate > latest.startDate ? task : latest)
        : null;
      batchStartDateRef.current = lastTask 
        ? new Date(lastTask.startDate.getTime() + lastTask.duration * 24 * 60 * 60 * 1000)
        : new Date();
      batchCumulativeDays.current = 0;
    }

    let startDate: Date;

    if (taskData.startDate) {
      startDate = typeof taskData.startDate === "string"
        ? new Date(`${taskData.startDate}T00:00:00`)
        : new Date(taskData.startDate);
      if (sequenceOrder >= 0) {
        batchStartDateRef.current = new Date(startDate.getTime() + taskData.duration * 24 * 60 * 60 * 1000);
        batchCumulativeDays.current = 0;
      }
    } else if (sequenceOrder >= 0 && batchStartDateRef.current) {
      // Batch task - calculate date based on cumulative duration
      startDate = new Date(batchStartDateRef.current.getTime() + batchCumulativeDays.current * 24 * 60 * 60 * 1000);
      batchCumulativeDays.current += taskData.duration;
    } else {
      // Single task - use old logic
      const lastTask = tasks.length > 0 
        ? tasks.reduce((latest, task) => task.startDate > latest.startDate ? task : latest)
        : null;
      startDate = lastTask 
        ? new Date(lastTask.startDate.getTime() + 5 * 24 * 60 * 60 * 1000)
        : new Date();
    }

    const task: Omit<Task, "id"> = {
      creationId: taskData.creationId,
      name: taskData.name,
      trade: taskData.trade,
      manpower: taskData.manpower,
      equipment: taskData.equipment || "",
      duration: taskData.duration,
      startDate,
      notes: taskData.notes,
    };

    return handleAddTask(task);
  };

  const handleUpdateTask = async (id: string, updates: Partial<Task>) => {
    const updateData: any = {};
    
    if (updates.startDate) {
      updateData.start_date = updates.startDate.toISOString();
    }
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.trade !== undefined) updateData.trade = updates.trade;
    if (updates.manpower !== undefined) updateData.manpower = updates.manpower;
    if (updates.equipment !== undefined) updateData.equipment = updates.equipment;
    if (updates.duration !== undefined) updateData.duration = updates.duration;
    if (updates.notes !== undefined) updateData.notes = updates.notes;

    const { error } = await supabase
      .from("tasks")
      .update(updateData)
      .eq("id", id);

    if (error) {
      toast({
        title: "Error updating task",
        description: error.message,
        variant: "destructive",
      });
      throw error;
    }

    toast({
      title: "Task updated",
      description: "The task has been updated successfully.",
    });

    loadTasks();
  };

  const handleApplyPlan = async (updates: { id: string; startDate: Date }[]) => {
    if (!updates.length) return;
    if (!projectId) throw new Error("No project selected.");
    const { error } = await supabase.rpc("apply_schedule_dates", { _project_id: projectId, _updates: updates.map(u => ({ id: u.id, start_date: u.startDate.toISOString() })) });
    if (error) throw error;
    await loadTasks();
  };

  const handleDeleteTask = async (id: string) => {
    const { error } = await supabase
      .from("tasks")
      .delete()
      .eq("id", id);

    if (error) {
      toast({
        title: "Error deleting task",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Task deleted",
      description: "The task has been removed from the schedule.",
    });

    loadTasks();
  };

  if (loading || !project) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <HardHat className="h-12 w-12 mx-auto text-primary animate-pulse mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-background pb-28">
      {/* Header */}
      <header className="border-b border-steel-dark bg-steel-dark">
        <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-6">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/scheduling")}
              className="text-white hover:bg-white/10 flex-shrink-0"
            >
              <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5" />
            </Button>
            <div className="bg-construction-orange text-white p-1.5 sm:p-2 rounded-lg flex-shrink-0">
              <HardHat className="h-4 w-4 sm:h-6 sm:w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg sm:text-2xl lg:text-3xl font-bold text-white truncate">{project.name}</h1>
              <p className="text-xs sm:text-sm text-white/80 hidden sm:block">
                {project.description || "Voice-first construction scheduling"}
              </p>
            </div>
            <div className="flex-shrink-0">
              <ChangePasswordDialog />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-3 sm:px-4 py-4 sm:py-8 space-y-4 sm:space-y-8">
        {/* Resource Summary */}
        <ResourceSummary tasks={tasks} projectId={projectId} />

        {/* Add Task Form */}
        <TaskForm 
          onAddTask={handleAddTask}
          onUpdateTask={handleUpdateTaskFromForm}
          editingTask={editingTask}
          onCancelEdit={() => setEditingTask(null)}
          lastTaskDate={tasks.length > 0 ? tasks[tasks.length - 1].startDate : undefined}
          existingTasks={tasks}
          onVoiceTaskCreated={handleVoiceTaskCreated}
        />

        {/* Schedule Views */}
        <div className="space-y-3 sm:space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-xl sm:text-2xl font-semibold">Schedule</h2>
              <span className="text-xs sm:text-sm text-muted-foreground">
                {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ScheduleUploadReview tasks={tasks} onImportTasks={handleImportTasks} />
              <ScheduleProposalExport
                projectId={projectId}
                projectName={project.name}
                projectDescription={project.description}
                tasks={tasks}
              />
            </div>
          </div>



          {tasks.length === 0 ? (
            <div className="text-center py-8 sm:py-12 border-2 border-dashed border-border rounded-lg">
              <HardHat className="h-10 w-10 sm:h-12 sm:w-12 mx-auto text-muted-foreground mb-3 sm:mb-4" />
              <p className="text-base sm:text-lg font-medium text-muted-foreground mb-1 sm:mb-2">No tasks yet</p>
              <p className="text-xs sm:text-sm text-muted-foreground px-4">
                Add your first task using voice or the form above
              </p>
            </div>
          ) : (
            <Tabs defaultValue="list" className="w-full">
              <TabsList className="grid w-full grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1 h-auto p-1">
                <TabsTrigger value="list" className="flex items-center gap-1.5 text-xs sm:text-sm px-2 py-2">
                  <List className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  <span className="hidden sm:inline">List</span>
                  <span className="sm:hidden">List</span>
                </TabsTrigger>
                <TabsTrigger value="gantt" className="flex items-center gap-1.5 text-xs sm:text-sm px-2 py-2">
                  <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  <span className="hidden sm:inline">Gantt</span>
                  <span className="sm:hidden">Gantt</span>
                </TabsTrigger>
                <TabsTrigger value="board" className="flex items-center gap-1.5 text-xs sm:text-sm px-2 py-2 col-span-2 sm:col-span-1">
                  <Kanban className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  <span className="hidden sm:inline">Board</span>
                  <span className="sm:hidden">Board</span>
                </TabsTrigger>
                <TabsTrigger value="manpower" className="flex items-center gap-1.5 text-xs sm:text-sm px-2 py-2">
                  <BarChart3 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  <span className="hidden lg:inline">Manpower</span>
                  <span className="lg:hidden">Staff</span>
                </TabsTrigger>
                <TabsTrigger value="fuel" className="flex items-center gap-1.5 text-xs sm:text-sm px-2 py-2">
                  <Fuel className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  <span>Fuel</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="list" className="space-y-2 sm:space-y-3 mt-3 sm:mt-4">
                {tasks
                  .filter((task) => !task.parentId)
                  .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
                  .map((task) => {
                    const subtasks = tasks
                      .filter((t) => t.parentId === task.id)
                      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
                    
                     return (
                      <div key={task.id}>
                        <TaskRow task={task} onDelete={handleDeleteTask} onEdit={handleEditTask} />
                        {subtasks.length > 0 && (
                          <div className="ml-4 sm:ml-8 space-y-2 mt-2">
                            {subtasks.map((subtask) => (
                              <TaskRow key={subtask.id} task={subtask} onDelete={handleDeleteTask} onEdit={handleEditTask} isSubtask />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </TabsContent>

              <TabsContent value="gantt" className="mt-3 sm:mt-4">
                <GanttChart tasks={tasks} onUpdateTask={handleUpdateTask} onApplyPlan={handleApplyPlan} projectId={projectId} />
              </TabsContent>

              <TabsContent value="board" className="mt-3 sm:mt-4">
                <BoardView tasks={tasks} onUpdateTask={handleUpdateTask} />
              </TabsContent>

              <TabsContent value="manpower" className="mt-3 sm:mt-4">
                <ManpowerAnalysis tasks={tasks} projectId={projectId} />
              </TabsContent>

              <TabsContent value="fuel" className="mt-3 sm:mt-4">
                <FuelAnalysis tasks={tasks} />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </main>
      
      <AIBuddyChat
        onTaskCreated={handleVoiceTaskCreated}
        tasks={tasks}
        onTaskUpdated={handleUpdateTask}
      />
      {projectId && <SpecsChat projectId={projectId} />}
    </div>
  );
};

export default ProjectSchedule;
