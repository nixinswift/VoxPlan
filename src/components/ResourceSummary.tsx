import { Task } from "@/types/schedule";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Wrench, Calendar } from "lucide-react";
import { useMemo } from "react";
import { peakConcurrentWorkers } from "@/lib/scheduleMetrics";
import { useProjectHolidays } from "@/hooks/useProjectHolidays";
import { parseEquipment } from "@/lib/scheduleEngine";

interface ResourceSummaryProps {
  tasks: Task[];
  projectId?: string;
}

export const ResourceSummary = ({ tasks, projectId }: ResourceSummaryProps) => {
  const { isHoliday } = useProjectHolidays(projectId);
  const totalWorkers = useMemo(() => peakConcurrentWorkers(tasks, isHoliday), [tasks, isHoliday]);
  
  // Get unique equipment (filter out null, empty strings, and "null" string)
  const equipmentSet = new Set(tasks.flatMap(t => parseEquipment(t.equipment)));
  
  // Get date range
  const dates = tasks.map(t => {
    const start = new Date(t.startDate);
    const end = new Date(t.startDate);
    end.setDate(end.getDate() + t.duration);
    return { start, end };
  });
  
  const earliestStart = dates.length > 0 
    ? new Date(Math.min(...dates.map(d => d.start.getTime())))
    : new Date();
  
  const latestEnd = dates.length > 0
    ? new Date(Math.max(...dates.map(d => d.end.getTime())))
    : new Date();

  const projectDuration = Math.ceil((latestEnd.getTime() - earliestStart.getTime()) / (1000 * 60 * 60 * 24));

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 px-4 pt-4 sm:px-6 sm:pt-6">
          <CardTitle className="text-xs sm:text-sm font-medium">Peak Workforce</CardTitle>
          <Users className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="px-4 pb-4 sm:px-6 sm:pb-6">
          <div className="text-xl sm:text-2xl font-bold">{totalWorkers}</div>
          <p className="text-[10px] sm:text-xs text-muted-foreground">
            Maximum workers at one time
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 px-4 pt-4 sm:px-6 sm:pt-6">
          <CardTitle className="text-xs sm:text-sm font-medium">Equipment</CardTitle>
          <Wrench className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="px-4 pb-4 sm:px-6 sm:pb-6">
          <div className="text-xl sm:text-2xl font-bold">{equipmentSet.size}</div>
          <p className="text-[10px] sm:text-xs text-muted-foreground">
            Unique equipment types
          </p>
        </CardContent>
      </Card>

      <Card className="sm:col-span-2 lg:col-span-1">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 px-4 pt-4 sm:px-6 sm:pt-6">
          <CardTitle className="text-xs sm:text-sm font-medium">Project Duration</CardTitle>
          <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="px-4 pb-4 sm:px-6 sm:pb-6">
          <div className="text-xl sm:text-2xl font-bold">{projectDuration || 0}</div>
          <p className="text-[10px] sm:text-xs text-muted-foreground">
            Calendar days
          </p>
        </CardContent>
      </Card>
    </div>
  );
};
