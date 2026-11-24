import { Task, TradeType } from "@/types/schedule";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { format, startOfDay, isSameDay, eachDayOfInterval } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

interface BoardViewProps {
  tasks: Task[];
  onUpdateTask?: (id: string, updates: Partial<Task>) => void;
}

const tradeColors: Record<string, { bg: string; border: string; text: string }> = {
  electrical: { bg: "bg-yellow-200", border: "border-yellow-300", text: "text-yellow-900" },
  mechanical: { bg: "bg-cyan-200", border: "border-cyan-300", text: "text-cyan-900" },
  plumbing: { bg: "bg-blue-300", border: "border-blue-400", text: "text-blue-900" },
  structural: { bg: "bg-pink-300", border: "border-pink-400", text: "text-pink-900" },
  finishes: { bg: "bg-orange-200", border: "border-orange-300", text: "text-orange-900" },
  general: { bg: "bg-lime-200", border: "border-lime-300", text: "text-lime-900" },
  asbestos_abatement: { bg: "bg-yellow-100", border: "border-yellow-500", text: "text-yellow-900" },
  demolition: { bg: "bg-red-100", border: "border-red-600", text: "text-red-900" },
  concrete_construction: { bg: "bg-blue-100", border: "border-blue-600", text: "text-blue-900" },
  concrete_pour: { bg: "bg-blue-100", border: "border-blue-700", text: "text-blue-900" },
  concrete_cutting: { bg: "bg-blue-100", border: "border-blue-500", text: "text-blue-900" },
  concrete_grinding: { bg: "bg-blue-100", border: "border-blue-400", text: "text-blue-900" },
  concrete_finishing: { bg: "bg-blue-100", border: "border-blue-800", text: "text-blue-900" },
  rebar: { bg: "bg-amber-100", border: "border-amber-700", text: "text-amber-900" },
  formwork: { bg: "bg-teal-100", border: "border-teal-600", text: "text-teal-900" },
  civil: { bg: "bg-emerald-100", border: "border-emerald-600", text: "text-emerald-900" },
};

const defaultTradeColor = { bg: "bg-gray-200", border: "border-gray-300", text: "text-gray-900" };

export const BoardView = ({ tasks, onUpdateTask }: BoardViewProps) => {
  const [weekOffset, setWeekOffset] = useState(0);
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const DAYS_PER_PAGE = 14; // Show 2 weeks at a time

  if (tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No tasks to display. Add your first task to see the board view.
      </div>
    );
  }

  // Get all days in the project
  const earliestTask = tasks.reduce((earliest, task) => 
    new Date(task.startDate) < new Date(earliest.startDate) ? task : earliest
  );
  const latestTask = tasks.reduce((latest, task) => {
    const taskEnd = new Date(task.startDate);
    taskEnd.setDate(taskEnd.getDate() + task.duration - 1);
    const latestEnd = new Date(latest.startDate);
    latestEnd.setDate(latestEnd.getDate() + latest.duration - 1);
    return taskEnd > latestEnd ? task : latest;
  });

  const startDate = startOfDay(new Date(earliestTask.startDate));
  const endDateCalc = new Date(latestTask.startDate);
  endDateCalc.setDate(endDateCalc.getDate() + latestTask.duration - 1);
  const endDate = startOfDay(endDateCalc);
  
  const allDays = eachDayOfInterval({ start: startDate, end: endDate });

  // Calculate pagination
  const totalPages = Math.ceil(allDays.length / DAYS_PER_PAGE);
  const startIndex = weekOffset * DAYS_PER_PAGE;
  const endIndex = Math.min(startIndex + DAYS_PER_PAGE, allDays.length);
  const visibleDays = allDays.slice(startIndex, endIndex);

  const canGoPrevious = weekOffset > 0;
  const canGoNext = weekOffset < totalPages - 1;

  const handleDragStart = (task: Task) => {
    setDraggedTask(task);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (day: Date) => {
    if (!draggedTask || !onUpdateTask) return;
    
    const newStartDate = startOfDay(day);
    const currentStartDate = startOfDay(new Date(draggedTask.startDate));
    
    // Only update if the date actually changed
    if (newStartDate.getTime() !== currentStartDate.getTime()) {
      onUpdateTask(draggedTask.id, { startDate: newStartDate });
    }
    
    setDraggedTask(null);
  };

  const handleDragEnd = () => {
    setDraggedTask(null);
  };

  // Group tasks by visible days - show task on every day it's active
  const tasksByDay = visibleDays.map(day => {
    const dayTasks = tasks.filter(task => {
      const taskStart = startOfDay(new Date(task.startDate));
      const taskEnd = new Date(taskStart);
      taskEnd.setDate(taskEnd.getDate() + task.duration - 1);
      const taskEndDay = startOfDay(taskEnd);
      
      return day >= taskStart && day <= taskEndDay;
    });
    return { day, tasks: dayTasks };
  });

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Navigation Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 bg-muted/50 p-2 sm:p-3 rounded-lg">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setWeekOffset(weekOffset - 1)}
          disabled={!canGoPrevious}
          className="text-xs sm:text-sm"
        >
          <ChevronLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
          <span className="hidden sm:inline">Previous 2 Weeks</span>
          <span className="sm:hidden">Previous</span>
        </Button>
        
        <div className="text-xs sm:text-sm font-medium text-center">
          <div>{format(visibleDays[0], 'MMM d')} - {format(visibleDays[visibleDays.length - 1], 'MMM d, yyyy')}</div>
          <span className="text-muted-foreground text-[10px] sm:text-xs">
            (Page {weekOffset + 1} of {totalPages})
          </span>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setWeekOffset(weekOffset + 1)}
          disabled={!canGoNext}
          className="text-xs sm:text-sm"
        >
          <span className="hidden sm:inline">Next 2 Weeks</span>
          <span className="sm:hidden">Next</span>
          <ChevronRight className="h-3 w-3 sm:h-4 sm:w-4 ml-1" />
        </Button>
      </div>

      {/* Board Columns */}
      <div className="overflow-x-auto pb-4 -mx-3 px-3 sm:mx-0 sm:px-0">
        <div className="flex gap-2 sm:gap-4 min-w-max">
          {tasksByDay.map(({ day, tasks }) => (
            <div 
              key={day.toISOString()} 
              className="flex-shrink-0 w-36 sm:w-48"
              onDragOver={handleDragOver}
              onDrop={() => handleDrop(day)}
            >
              <div className="sticky top-0 bg-background z-10 pb-1.5 sm:pb-2 mb-1.5 sm:mb-2 border-b">
                <h3 className="font-semibold text-xs sm:text-sm">
                  {format(day, 'M/d/yy')}
                </h3>
                <p className="text-[10px] sm:text-xs text-muted-foreground">
                  {format(day, 'EEE, MMM d')}
                </p>
              </div>
              
              <div className="space-y-2 sm:space-y-3 min-h-[100px] p-1 sm:p-2 rounded-lg transition-colors"
                style={{
                  backgroundColor: draggedTask ? 'rgba(0,0,0,0.02)' : 'transparent'
                }}
              >
                {tasks.length === 0 ? (
                  <div className="h-16 sm:h-20 rounded-lg border-2 border-dashed border-muted-foreground/20 flex items-center justify-center">
                    <span className="text-[10px] sm:text-xs text-muted-foreground">No tasks</span>
                  </div>
                ) : (
                tasks.map((task) => {
                    const colors = tradeColors[task.trade.toLowerCase().replace(/\s+/g, '_')] || defaultTradeColor;
                    const taskStart = startOfDay(new Date(task.startDate));
                    const isFirstDay = isSameDay(taskStart, day);
                    const isDragging = draggedTask?.id === task.id;
                    
                    return (
                      <Card
                        key={task.id}
                        draggable={isFirstDay && !!onUpdateTask}
                        onDragStart={() => handleDragStart(task)}
                        onDragEnd={handleDragEnd}
                        className={`p-2 sm:p-3 ${colors.bg} ${colors.border} border-2 shadow-md hover:shadow-lg transition-all cursor-move transform hover:rotate-1 hover:scale-105 ${!isFirstDay ? 'opacity-75' : ''} ${isDragging ? 'opacity-50 scale-95' : ''}`}
                        style={{
                          boxShadow: isDragging ? '2px 2px 8px rgba(0,0,0,0.2)' : '2px 2px 4px rgba(0,0,0,0.1)',
                        }}
                      >
                        <div className={`space-y-0.5 sm:space-y-1 ${colors.text}`}>
                          <h4 className="font-bold text-xs sm:text-sm leading-tight line-clamp-2">
                            {task.name}
                          </h4>
                          <div className="text-[10px] sm:text-xs space-y-0.5">
                            <p className="font-semibold uppercase tracking-wide">
                              {task.trade}
                            </p>
                            <p>{task.manpower} workers</p>
                            {task.equipment && task.equipment !== 'null' && (
                              <p className="truncate">{task.equipment}</p>
                            )}
                            <p className="font-medium">{task.duration} days</p>
                            {isFirstDay && (
                              <p className="text-[9px] sm:text-[10px] opacity-75">
                                Start: {format(new Date(task.startDate), 'M/d/yy')}
                              </p>
                            )}
                          </div>
                        </div>
                      </Card>
                    );
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
