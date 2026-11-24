import { Task } from "@/types/schedule";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { format, eachDayOfInterval, startOfDay, isWithinInterval } from "date-fns";
import { AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useState, useMemo, useEffect } from "react";
import { useProjectHolidays } from "@/hooks/useProjectHolidays";

interface ManpowerAnalysisProps {
  tasks: Task[];
  projectId?: string;
}

interface DailyManpower {
  date: Date;
  workers: number;
  dateLabel: string;
  isHoliday?: boolean;
  holidayName?: string | null;
}

interface Anomaly {
  date: Date;
  workers: number;
  previousWorkers: number;
  change: number;
  percentChange: number;
  type: "spike" | "drop";
}

const TRADE_COLORS = [
  "#2563eb", "#dc2626", "#16a34a", "#ca8a04", "#9333ea",
  "#0891b2", "#e11d48", "#65a30d", "#d97706", "#6366f1",
  "#0d9488", "#c026d3", "#ea580c", "#4f46e5", "#059669",
  "#be123c", "#7c3aed",
];

export const ManpowerAnalysis = ({ tasks, projectId }: ManpowerAnalysisProps) => {
  const [aiInsights, setAiInsights] = useState<any>(null);
  const [loadingAI, setLoadingAI] = useState(false);
  const { isHoliday, getHolidayName, holidays } = useProjectHolidays(projectId);

  // Clear AI insights when tasks change
  useEffect(() => {
    setAiInsights(null);
  }, [tasks]);

  // Memoize all calculations
  const { dailyManpower, anomalies, avgWorkers, maxWorkers, minWorkers, chartData, startDate, endDate, tradeList } = useMemo(() => {
    if (tasks.length === 0) {
      return { 
        dailyManpower: [], 
        anomalies: [], 
        avgWorkers: 0, 
        maxWorkers: 0, 
        minWorkers: 0, 
        chartData: [],
        startDate: new Date(),
        endDate: new Date()
      };
    }

    // Calculate date range from tasks
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

    // Collect all unique trades
    const allTrades = new Set<string>();
    tasks.forEach(t => allTrades.add(t.trade));
    const tradeList = Array.from(allTrades).sort();

    // Calculate daily manpower with trade-based pooling
    const dailyManpower: DailyManpower[] = allDays.map(day => {
      const dayStart = startOfDay(day);
      
      if (isHoliday(day)) {
        return {
          date: day,
          workers: 0,
          dateLabel: format(day, "MMM d"),
          isHoliday: true,
          holidayName: getHolidayName(day),
        };
      }

      const workersByTrade: Record<string, number> = {};
      
      tasks.forEach(task => {
        const taskStart = startOfDay(new Date(task.startDate));
        const taskEnd = new Date(taskStart);
        taskEnd.setDate(taskEnd.getDate() + task.duration - 1);
        taskEnd.setHours(23, 59, 59, 999);

        const isTaskActive = isWithinInterval(day, { start: taskStart, end: taskEnd });
        if (isTaskActive) {
          workersByTrade[task.trade] = (workersByTrade[task.trade] || 0) + task.manpower;
        }
      });

      const workersOnDay = Object.values(workersByTrade).reduce((sum, count) => sum + count, 0);

      return {
        date: day,
        workers: workersOnDay,
        dateLabel: format(day, "MMM d"),
        isHoliday: false,
        holidayName: null,
        workersByTrade,
      };
    });

    // Detect anomalies
    const anomalies: Anomaly[] = [];
    const SPIKE_THRESHOLD = 50;
    const DROP_THRESHOLD = 40;
    const MIN_WORKERS_FOR_DETECTION = 10;

    for (let i = 1; i < dailyManpower.length; i++) {
      const current = dailyManpower[i];
      const previous = dailyManpower[i - 1];
      
      if (previous.workers >= MIN_WORKERS_FOR_DETECTION || current.workers >= MIN_WORKERS_FOR_DETECTION) {
        const change = current.workers - previous.workers;
        const percentChange = previous.workers > 0 
          ? (change / previous.workers) * 100 
          : current.workers > 0 ? 100 : 0;

        if (percentChange > SPIKE_THRESHOLD && Math.abs(change) >= 10) {
          anomalies.push({
            date: current.date,
            workers: current.workers,
            previousWorkers: previous.workers,
            change,
            percentChange,
            type: "spike",
          });
        } else if (percentChange < -DROP_THRESHOLD && Math.abs(change) >= 10) {
          anomalies.push({
            date: current.date,
            workers: current.workers,
            previousWorkers: previous.workers,
            change,
            percentChange,
            type: "drop",
          });
        }
      }
    }

    // Calculate statistics (exclude holidays from average calculation)
    const workingDays = dailyManpower.filter(d => !d.isHoliday);
    const totalWorkers = workingDays.reduce((sum, day) => sum + day.workers, 0);
    const avgWorkers = workingDays.length > 0 ? Math.round(totalWorkers / workingDays.length) : 0;
    const maxWorkers = workingDays.length > 0 ? Math.max(...workingDays.map(d => d.workers)) : 0;
    const minWorkers = workingDays.length > 0 ? Math.min(...workingDays.map(d => d.workers)) : 0;

    // Prepare chart data with per-trade breakdown
    const chartData = dailyManpower.map(d => {
      const tradeData: Record<string, number> = {};
      tradeList.forEach(trade => {
        tradeData[trade] = (d as any).workersByTrade?.[trade] || 0;
      });
      return {
        date: d.dateLabel,
        workers: d.workers,
        fullDate: format(d.date, "MMM d, yyyy"),
        isHoliday: d.isHoliday,
        holidayName: d.holidayName,
        ...tradeData,
      };
    });

    return { dailyManpower, anomalies, avgWorkers, maxWorkers, minWorkers, chartData, startDate, endDate, tradeList };
  }, [tasks, isHoliday, getHolidayName]);

  if (tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No tasks to analyze. Add tasks to see manpower analysis.
      </div>
    );
  }

  const handleAIAnalysis = async () => {
    setLoadingAI(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-manpower", {
        body: {
          tasks: tasks.map(t => ({
            id: t.id,
            name: t.name,
            trade: t.trade,
            manpower: t.manpower,
            duration: t.duration,
            startDate: t.startDate.toISOString(),
            equipment: t.equipment,
            notes: t.notes,
          })),
        },
      });

      if (error) {
        console.error("AI analysis error:", error);
        toast({
          title: "VoxPlan Analysis Failed",
          description: error.message || "Failed to analyze manpower data",
          variant: "destructive",
        });
        return;
      }

      setAiInsights(data);
      toast({
        title: "VoxPlan Analysis Complete",
        description: "Advanced insights generated successfully",
      });
    } catch (err) {
      console.error("Error calling AI analysis:", err);
      toast({
        title: "Error",
        description: "Failed to generate VoxPlan insights",
        variant: "destructive",
      });
    } finally {
      setLoadingAI(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* AI Analysis Button */}
      <Card className="bg-gradient-to-r from-primary/5 to-primary/10 border-primary/20">
        <CardHeader className="px-4 py-4 sm:px-6 sm:py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-lg sm:text-xl">
                Manpower Analysis
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Get advanced insights, predictions, and optimization recommendations
              </CardDescription>
            </div>
            <Button 
              onClick={handleAIAnalysis} 
              disabled={loadingAI}
              className="gap-2 w-full sm:w-auto"
            >
              {loadingAI ? (
                <>
                  <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Analyzing...
                </>
              ) : (
                "Generate Insights"
              )}
            </Button>
          </div>
        </CardHeader>
        {aiInsights && (
          <CardContent className="px-4 py-4 sm:px-6 sm:py-6">
            <div className="space-y-3 sm:space-y-4">
              {/* AI Summary Stats */}
              {aiInsights.summary && (
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  <div className="bg-background rounded-lg p-2 sm:p-3 border">
                    <p className="text-[10px] sm:text-xs text-muted-foreground">VoxPlan Min</p>
                    <p className="text-base sm:text-xl font-bold">{aiInsights.summary.min_workers}</p>
                  </div>
                  <div className="bg-background rounded-lg p-2 sm:p-3 border">
                    <p className="text-[10px] sm:text-xs text-muted-foreground">VoxPlan Max</p>
                    <p className="text-base sm:text-xl font-bold">{aiInsights.summary.max_workers}</p>
                  </div>
                  <div className="bg-background rounded-lg p-2 sm:p-3 border">
                    <p className="text-[10px] sm:text-xs text-muted-foreground">VoxPlan Avg</p>
                    <p className="text-base sm:text-xl font-bold">{aiInsights.summary.average_workers}</p>
                  </div>
                </div>
              )}

              {/* AI Alerts */}
              {aiInsights.alerts && aiInsights.alerts.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm">VoxPlan Alerts</h4>
                  {aiInsights.alerts.map((alert: any, idx: number) => (
                    <Alert key={idx} variant="destructive" className="bg-orange-50 dark:bg-orange-950 border-orange-200">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle className="text-sm">{alert.message}</AlertTitle>
                      <AlertDescription className="text-xs">
                        {alert.date}: {alert.previous_day_workers} → {alert.current_day_workers} workers
                      </AlertDescription>
                    </Alert>
                  ))}
                </div>
              )}

              {/* Biggest Changes */}
              {aiInsights.summary?.biggest_increase && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="bg-green-50 dark:bg-green-950 rounded-lg p-3 border border-green-200">
                    <p className="text-xs text-green-700 dark:text-green-300 font-semibold mb-1">
                      Biggest Increase
                    </p>
                    <p className="text-sm">
                      {aiInsights.summary.biggest_increase.from_date} → {aiInsights.summary.biggest_increase.to_date}
                    </p>
                    <p className="text-lg font-bold text-green-700 dark:text-green-300">
                      +{aiInsights.summary.biggest_increase.to_workers - aiInsights.summary.biggest_increase.from_workers} workers
                    </p>
                  </div>
                  <div className="bg-red-50 dark:bg-red-950 rounded-lg p-3 border border-red-200">
                    <p className="text-xs text-red-700 dark:text-red-300 font-semibold mb-1">
                      Biggest Drop
                    </p>
                    <p className="text-sm">
                      {aiInsights.summary.biggest_drop.from_date} → {aiInsights.summary.biggest_drop.to_date}
                    </p>
                    <p className="text-lg font-bold text-red-700 dark:text-red-300">
                      {aiInsights.summary.biggest_drop.to_workers - aiInsights.summary.biggest_drop.from_workers} workers
                    </p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Average Daily</CardDescription>
            <CardTitle className="text-2xl">{avgWorkers}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">workers per day</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Peak Workforce</CardDescription>
            <CardTitle className="text-2xl">{maxWorkers}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">maximum workers</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Minimum</CardDescription>
            <CardTitle className="text-2xl">{minWorkers}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">minimum workers</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Anomalies</CardDescription>
            <CardTitle className="text-2xl">{anomalies.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">detected spikes/drops</p>
          </CardContent>
        </Card>
      </div>

      {/* Warnings/Alerts */}
      {anomalies.length > 0 && (
        <Card className="border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-orange-900 dark:text-orange-100">
              <AlertTriangle className="h-5 w-5" />
              Manpower Alerts
            </CardTitle>
            <CardDescription className="text-orange-700 dark:text-orange-300">
              Significant changes in workforce detected
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {anomalies.map((anomaly, index) => (
              <Alert key={index} variant={anomaly.type === "spike" ? "default" : "destructive"}>
                <div className="flex items-start gap-2">
                  {anomaly.type === "spike" ? (
                    <TrendingUp className="h-4 w-4 mt-0.5" />
                  ) : (
                    <TrendingDown className="h-4 w-4 mt-0.5" />
                  )}
                  <div className="flex-1">
                    <AlertTitle className="text-sm font-semibold">
                      {anomaly.type === "spike" ? "Sudden Increase" : "Sudden Drop"} on{" "}
                      {format(anomaly.date, "MMM d, yyyy")}
                    </AlertTitle>
                    <AlertDescription className="text-xs">
                      {anomaly.previousWorkers} → {anomaly.workers} workers (
                      {anomaly.percentChange > 0 ? "+" : ""}
                      {Math.round(anomaly.percentChange)}% change, {anomaly.change > 0 ? "+" : ""}
                      {anomaly.change} workers)
                    </AlertDescription>
                  </div>
                </div>
              </Alert>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Manpower Curve Graph - Stacked by Discipline */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Manpower Curve by Discipline</CardTitle>
          <CardDescription>
            Worker count by trade over project timeline ({format(startDate, "MMM d")} -{" "}
            {format(endDate, "MMM d, yyyy")})
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="date" 
                tick={{ fontSize: 12 }}
                angle={-45}
                textAnchor="end"
                height={80}
              />
              <YAxis 
                label={{ value: "Workers", angle: -90, position: "insideLeft" }}
                tick={{ fontSize: 12 }}
              />
              <Tooltip 
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0]?.payload;
                    return (
                      <div className="bg-background border border-border p-3 rounded-lg shadow-lg">
                        <p className="font-semibold">{data.fullDate}</p>
                        {data.isHoliday ? (
                          <p className="text-sm text-destructive font-medium">
                            🎄 {data.holidayName || 'Holiday'} - No Work
                          </p>
                        ) : (
                          <>
                            {payload.filter((p: any) => p.value > 0).map((p: any, i: number) => (
                              <div key={i} className="flex items-center gap-2 text-sm">
                                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: p.color }} />
                                <span className="capitalize">{String(p.dataKey).replace(/_/g, ' ')}</span>
                                <span className="font-semibold ml-auto">{p.value}</span>
                              </div>
                            ))}
                            <div className="border-t border-border mt-1 pt-1 text-sm font-semibold">
                              Total: {data.workers}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <ReferenceLine 
                y={avgWorkers} 
                stroke="hsl(var(--muted-foreground))" 
                strokeDasharray="5 5"
                label={{ value: `Avg: ${avgWorkers}`, position: "right", fontSize: 12 }}
              />
              {tradeList.map((trade, index) => (
                <Area
                  key={trade}
                  type="monotone"
                  dataKey={trade}
                  stackId="1"
                  stroke={TRADE_COLORS[index % TRADE_COLORS.length]}
                  fill={TRADE_COLORS[index % TRADE_COLORS.length]}
                  fillOpacity={0.6}
                  name={trade}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
          {/* Legend */}
          <div className="flex flex-wrap gap-3 mt-4 justify-center">
            {tradeList.map((trade, index) => (
              <div key={trade} className="flex items-center gap-1.5 text-xs">
                <div
                  className="w-3 h-3 rounded-sm"
                  style={{ backgroundColor: TRADE_COLORS[index % TRADE_COLORS.length] }}
                />
                <span className="capitalize">{trade.replace(/_/g, ' ')}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Daily Totals Table */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Workforce Totals</CardTitle>
          <CardDescription>Complete breakdown of workers scheduled per day</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-[400px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Day</TableHead>
                  <TableHead className="text-right">Workers</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dailyManpower.map((day, index) => {
                  const previousDay = index > 0 ? dailyManpower[index - 1] : null;
                  const change = previousDay ? day.workers - previousDay.workers : 0;
                  const hasAnomaly = anomalies.some(a => 
                    format(a.date, "yyyy-MM-dd") === format(day.date, "yyyy-MM-dd")
                  );

                  return (
                    <TableRow key={format(day.date, "yyyy-MM-dd")} className={hasAnomaly ? "bg-orange-50 dark:bg-orange-950" : ""}>
                      <TableCell className="font-medium">
                        {format(day.date, "MMM d, yyyy")}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {format(day.date, "EEEE")}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {day.workers}
                      </TableCell>
                      <TableCell className="text-right">
                        {index > 0 && (
                          <span className={change > 0 ? "text-green-600" : change < 0 ? "text-red-600" : "text-muted-foreground"}>
                            {change > 0 ? "+" : ""}{change}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
