import { Task } from "@/types/schedule";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMemo, useState } from "react";
import { format, differenceInDays, startOfWeek, addWeeks, eachDayOfInterval } from "date-fns";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { OptimizeScheduleDialog } from "./OptimizeScheduleDialog";
import { useProjectHolidays } from "@/hooks/useProjectHolidays";

interface GanttChartProps {
  tasks: Task[];
  onUpdateTask?: (id: string, updates: Partial<Task>) => void;
  onApplyPlan?: (updates: { id: string; startDate: Date }[]) => void | Promise<void>;
  projectId?: string;
}

const tradeColorMap: Record<string, string> = {
  electrical: "bg-trade-electrical",
  mechanical: "bg-trade-mechanical",
  plumbing: "bg-trade-plumbing",
  structural: "bg-trade-structural",
  finishes: "bg-trade-finishes",
  general: "bg-trade-general",
  asbestos_abatement: "bg-yellow-500",
  demolition: "bg-red-600",
  concrete_construction: "bg-blue-600",
  concrete: "bg-blue-600",
  concrete_pour: "bg-blue-700",
  concrete_cutting: "bg-blue-500",
  concrete_grinding: "bg-blue-400",
  concrete_finishing: "bg-blue-800",
  rebar: "bg-amber-700",
  formwork: "bg-teal-600",
  civil: "bg-emerald-600",
  site_work: "bg-emerald-700",
  carpentry: "bg-amber-600",
  hvac: "bg-orange-600",
  roofing: "bg-stone-800",
};

const defaultTradeColor = "bg-slate-500";

const getTradeColor = (trade: string): string => {
  const normalizedTrade = trade.toLowerCase().replace(/\s+/g, '_');
  return tradeColorMap[normalizedTrade] || defaultTradeColor;
};

export const GanttChart = ({ tasks, onUpdateTask, onApplyPlan, projectId }: GanttChartProps) => {
  const [optimizeOpen, setOptimizeOpen] = useState(false);
  const { isHoliday, getHolidayName } = useProjectHolidays(projectId);

  const { startDate, endDate, totalDays } = useMemo(() => {
    if (tasks.length === 0) return { startDate: new Date(), endDate: new Date(), totalDays: 0 };

    const dates = tasks.map(task => {
      const start = new Date(task.startDate);
      const end = new Date(task.startDate);
      end.setDate(end.getDate() + task.duration);
      return { start, end };
    });

    const minDate = new Date(Math.min(...dates.map(d => d.start.getTime())));
    const maxDate = new Date(Math.max(...dates.map(d => d.end.getTime())));
    
    // Add padding
    minDate.setDate(minDate.getDate() - 3);
    maxDate.setDate(maxDate.getDate() + 7);
    
    const days = Math.ceil((maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    return { startDate: minDate, endDate: maxDate, totalDays: days };
  }, [tasks]);

  const getTaskPosition = (task: Task) => {
    const taskStart = new Date(task.startDate);
    const daysFromStart = Math.floor((taskStart.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const leftPercent = (daysFromStart / totalDays) * 100;
    const widthPercent = (task.duration / totalDays) * 100;
    return { left: `${leftPercent}%`, width: `${Math.max(widthPercent, 2)}%` };
  };

  // Today line position
  const todayPosition = useMemo(() => {
    const today = new Date();
    if (today < startDate || today > endDate) return null;
    const daysFromStart = differenceInDays(today, startDate);
    return (daysFromStart / totalDays) * 100;
  }, [startDate, endDate, totalDays]);

  // Generate week markers
  const weekMarkers = useMemo(() => {
    const markers = [];
    let current = startOfWeek(startDate, { weekStartsOn: 1 });
    
    while (current <= endDate) {
      const daysFromStart = differenceInDays(current, startDate);
      if (daysFromStart >= 0) {
        const position = (daysFromStart / totalDays) * 100;
        markers.push({
          date: new Date(current),
          position: `${position}%`,
          label: format(current, 'MMM d'),
          isMonthStart: current.getDate() <= 7
        });
      }
      current = addWeeks(current, 1);
    }
    return markers;
  }, [startDate, endDate, totalDays]);

  // Generate holiday markers
  const holidayMarkers = useMemo(() => {
    if (totalDays === 0) return [];
    const allDays = eachDayOfInterval({ start: startDate, end: endDate });
    return allDays
      .filter(day => isHoliday(day))
      .map(day => {
        const daysFromStart = differenceInDays(day, startDate);
        const position = (daysFromStart / totalDays) * 100;
        const width = (1 / totalDays) * 100;
        return {
          date: day,
          position: `${position}%`,
          width: `${Math.max(width, 0.5)}%`,
          name: getHolidayName(day)
        };
      });
  }, [startDate, endDate, totalDays, isHoliday, getHolidayName]);

  // Generate month markers for header
  const monthMarkers = useMemo(() => {
    const markers = [];
    const current = new Date(startDate);
    current.setDate(1);

    while (current <= endDate) {
      const daysFromStart = Math.floor((current.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const position = Math.max(0, (daysFromStart / totalDays) * 100);
      
      markers.push({
        date: new Date(current),
        position: `${position}%`,
        label: format(current, 'MMMM yyyy')
      });

      current.setMonth(current.getMonth() + 1);
    }
    return markers;
  }, [startDate, endDate, totalDays]);

  const topLevelTasks = tasks.filter(t => !t.parentId);

  if (tasks.length === 0) {
    return (
      <Card className="p-8 text-center text-muted-foreground">
        No tasks to display in Gantt chart
      </Card>
    );
  }

  const TaskBar = ({ task, isSubtask = false }: { task: Task; isSubtask?: boolean }) => {
    const taskEndDate = new Date(task.startDate);
    taskEndDate.setDate(taskEndDate.getDate() + task.duration);
    
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={`absolute ${isSubtask ? 'top-0.5 h-5 sm:h-6 opacity-80' : 'top-1 h-6 sm:h-8'} ${getTradeColor(task.trade)} rounded-md flex items-center px-1.5 sm:px-2 transition-all hover:opacity-90 hover:scale-[1.02] cursor-pointer shadow-sm`}
              style={getTaskPosition(task)}
            >
              <span className="text-[10px] sm:text-xs font-medium text-white truncate">
                {task.duration}d
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <div className="space-y-1">
              <p className="font-semibold">{task.name}</p>
              <p className="text-xs text-muted-foreground capitalize">{task.trade}</p>
              <div className="text-xs space-y-0.5 pt-1 border-t">
                <p><span className="text-muted-foreground">Start:</span> {format(new Date(task.startDate), 'MMM d, yyyy')}</p>
                <p><span className="text-muted-foreground">End:</span> {format(taskEndDate, 'MMM d, yyyy')}</p>
                <p><span className="text-muted-foreground">Duration:</span> {task.duration} days</p>
                <p><span className="text-muted-foreground">Manpower:</span> {task.manpower} workers</p>
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  const handleApplySuggestion = (taskId: string, newStartDate: Date) => {
    if (onUpdateTask) {
      onUpdateTask(taskId, { startDate: newStartDate });
    }
  };

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Optimize Button */}
      <div className="flex justify-end">
        <Button onClick={() => setOptimizeOpen(true)} variant="outline" className="gap-2">
          Optimize Schedule
        </Button>
      </div>

      <Card className="p-3 sm:p-6 overflow-x-auto">
        <div className="min-w-[700px] sm:min-w-[900px]">
          {/* Month header */}
          <div className="relative h-6 sm:h-8 border-b border-border">
            {monthMarkers.map((marker, i) => (
              <div
                key={i}
                className="absolute top-0 h-full"
                style={{ left: marker.position }}
              >
                <span className="absolute top-1 left-1 sm:left-2 text-xs sm:text-sm font-semibold text-foreground">
                  {marker.label}
                </span>
              </div>
            ))}
          </div>

          {/* Week markers header */}
          <div className="relative h-8 sm:h-10 border-b border-border bg-muted/30">
            {weekMarkers.map((marker, i) => (
              <div
                key={i}
                className="absolute top-0 h-full border-l border-border/50"
                style={{ left: marker.position }}
              >
                <span className="absolute top-1.5 sm:top-2 left-1 text-[10px] sm:text-xs text-muted-foreground whitespace-nowrap">
                  {marker.label}
                </span>
              </div>
            ))}
            
            {/* Today indicator in header */}
            {todayPosition !== null && (
              <div
                className="absolute top-0 h-full w-0.5 bg-red-500 z-10"
                style={{ left: `${todayPosition}%` }}
              >
                <span className="absolute -top-0.5 left-1 text-[10px] font-bold text-red-500 whitespace-nowrap">
                  Today
                </span>
              </div>
            )}
          </div>

          {/* Task rows with grid */}
          <div className="relative">
            {/* Grid lines */}
            <div className="absolute inset-0 pointer-events-none">
              {/* Holiday backgrounds */}
              {holidayMarkers.map((holiday, i) => (
                <TooltipProvider key={`holiday-${i}`}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className="absolute top-0 h-full bg-red-500/15 border-l border-r border-red-500/30 cursor-help"
                        style={{ left: holiday.position, width: holiday.width }}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="font-medium">{holiday.name || 'Holiday'}</p>
                      <p className="text-xs text-muted-foreground">{format(holiday.date, 'MMM d, yyyy')}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ))}
              {weekMarkers.map((marker, i) => (
                <div
                  key={i}
                  className="absolute top-0 h-full border-l border-border/20"
                  style={{ left: marker.position }}
                />
              ))}
              {/* Today line through tasks */}
              {todayPosition !== null && (
                <div
                  className="absolute top-0 h-full w-0.5 bg-red-500/60 z-10"
                  style={{ left: `${todayPosition}%` }}
                />
              )}
            </div>

            <div className="space-y-1 sm:space-y-2 py-2">
              {topLevelTasks.map(task => {
                const subtasks = tasks.filter(t => t.parentId === task.id);
                return (
                  <div key={task.id} className="space-y-1">
                    {/* Parent task */}
                    <div className="flex items-center gap-2 sm:gap-4 py-1.5 sm:py-2 hover:bg-muted/20 rounded transition-colors">
                      <div className="w-40 sm:w-56 flex-shrink-0 pl-2">
                        <div className="font-semibold text-xs sm:text-sm truncate">{task.name}</div>
                        <div className="text-[10px] sm:text-xs text-muted-foreground">
                          <span className="capitalize">{task.trade}</span>
                          <span className="mx-1">•</span>
                          <span>{format(new Date(task.startDate), 'MMM d')}</span>
                        </div>
                      </div>
                      <div className="flex-1 relative h-8 sm:h-10">
                        <TaskBar task={task} />
                      </div>
                    </div>

                    {/* Subtasks */}
                    {subtasks.map(subtask => (
                      <div key={subtask.id} className="flex items-center gap-2 sm:gap-4 py-1.5 sm:py-2 pl-2 sm:pl-4 bg-muted/20 hover:bg-muted/30 rounded transition-colors">
                        <div className="w-40 sm:w-56 flex-shrink-0">
                          <div className="text-xs sm:text-sm truncate text-muted-foreground flex items-center gap-1">
                            <span className="text-muted-foreground/50">└</span>
                            {subtask.name}
                          </div>
                          <div className="text-[10px] text-muted-foreground/70 pl-3">
                            {format(new Date(subtask.startDate), 'MMM d')}
                          </div>
                        </div>
                        <div className="flex-1 relative h-6 sm:h-8">
                          <TaskBar task={subtask} isSubtask />
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Card>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 sm:gap-3 justify-center text-xs px-2">
        <div className="flex items-center gap-1.5 mr-4">
          <div className="w-3 h-3 bg-red-500 rounded" />
          <span className="font-medium">Today</span>
        </div>
        {holidayMarkers.length > 0 && (
          <div className="flex items-center gap-1.5 mr-4">
            <div className="w-3 h-3 bg-red-500/30 rounded border border-red-500/50" />
            <span className="font-medium text-red-600">Holiday</span>
          </div>
        )}
        {Array.from(new Set(tasks.map((t) => (t.trade || "general").toLowerCase().replace(/\s+/g, "_")))).map((trade) => (
          <div key={trade} className="flex items-center gap-1.5">
            <div className={`w-3 h-3 ${getTradeColor(trade)} rounded`} />
            <span className="capitalize text-muted-foreground">{trade.replace(/_/g, ' ')}</span>
          </div>
        ))}
      </div>

      {/* Optimize Dialog */}
      <OptimizeScheduleDialog
        open={optimizeOpen}
        onOpenChange={setOptimizeOpen}
        tasks={tasks}
        projectId={projectId}
        onApplySuggestion={handleApplySuggestion}
        onApplyPlan={onApplyPlan}
      />
    </div>
  );
};
