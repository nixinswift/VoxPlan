import { Task } from "@/types/schedule";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { format, eachDayOfInterval, startOfDay } from "date-fns";
import { AlertTriangle, Fuel, Droplet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useState, useMemo, useEffect } from "react";
import { fuelDateLabel } from "@/lib/scheduleMetrics";

interface FuelAnalysisProps {
  tasks: Task[];
}

interface EquipmentUsage {
  equipment: string;
  type: string;
  hoursPerDay: number;
}

export const FuelAnalysis = ({ tasks }: FuelAnalysisProps) => {
  const [aiInsights, setAiInsights] = useState<any>(null);
  const [loadingAI, setLoadingAI] = useState(false);

  // Clear AI insights when tasks change
  useEffect(() => {
    setAiInsights(null);
  }, [tasks]);

  // Memoize equipment records calculation to avoid unnecessary recalculations
  const equipmentRecords = useMemo(() => {
    // Extract equipment from tasks and build usage records
    const equipmentMap = new Map<string, EquipmentUsage[]>();
    
    tasks.forEach(task => {
      if (!task.equipment || task.equipment === 'null' || task.equipment.trim() === '') {
        return;
      }

      const startDate = startOfDay(new Date(task.startDate));
      
      for (let day = 0; day < task.duration; day++) {
        const currentDate = new Date(startDate);
        currentDate.setDate(currentDate.getDate() + day);
        const dateKey = format(currentDate, 'yyyy-MM-dd');
        
        if (!equipmentMap.has(dateKey)) {
          equipmentMap.set(dateKey, []);
        }
        
        // Parse equipment (could be comma-separated)
        const equipmentItems = task.equipment.split(',').map(e => e.trim()).filter(e => e);
        
        equipmentItems.forEach(equip => {
          const parsed = parseEquipmentName(equip);
          
          // Skip non-fuel equipment (electric/manual tools)
          if (parsed.isNonFuel) {
            return;
          }
          
          // Multiply hours by quantity for total equipment hours
          const totalHours = 8 * parsed.quantity;
          
          equipmentMap.get(dateKey)!.push({
            equipment: equip,
            type: parsed.type,
            hoursPerDay: totalHours,
          });
        });
      }
    });

    // Convert to AI format - send detailed info for AI to classify properly
    return Array.from(equipmentMap.entries()).flatMap(([date, usage]) => {
      return usage.map((item, idx) => {
        const parsed = parseEquipmentName(item.equipment);
        return {
          date,
          equipment_id: `${item.equipment}_${idx}`,
          equipment_type: parsed.type,
          equipment_class: parsed.equipment_class,
          model_name: parsed.model_name,
          tonnage: parsed.tonnage,
          hours_run: item.hoursPerDay,
        };
      });
    });
  }, [tasks]);

  if (tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No equipment data to analyze. Add tasks with equipment to see fuel analysis.
      </div>
    );
  }

  const handleAIAnalysis = async () => {
    if (equipmentRecords.length === 0) {
      toast({
        title: "No Equipment Data",
        description: "Add tasks with equipment information to analyze fuel usage",
        variant: "destructive",
      });
      return;
    }

    setLoadingAI(true);
    try {
      console.log("Sending equipment records to AI:", equipmentRecords.length);
      const { data, error } = await supabase.functions.invoke("analyze-fuel-burn", {
        body: { equipmentData: equipmentRecords },
      });

      console.log("AI Response data:", data);
      console.log("AI Response error:", error);

      if (error) {
        console.error("AI fuel analysis error:", error);
        toast({
          title: "VoxPlan Analysis Failed",
          description: error.message || "Failed to analyze fuel burn data",
          variant: "destructive",
        });
        return;
      }

      if (!data) {
        console.error("No data returned from AI analysis");
        toast({
          title: "VoxPlan Analysis Failed",
          description: "No data returned from analysis",
          variant: "destructive",
        });
        return;
      }

      console.log("Setting AI insights:", data);
      setAiInsights(data);
      toast({
        title: "Fuel Analysis Complete",
        description: "Equipment fuel insights generated successfully",
      });
    } catch (err) {
      console.error("Error calling fuel analysis:", err);
      toast({
        title: "Error",
        description: "Failed to generate fuel insights",
        variant: "destructive",
      });
    } finally {
      setLoadingAI(false);
    }
  };

  // Prepare basic chart data from equipment records with estimated fuel
  const recordsWithEstimates = equipmentRecords.map(r => ({
    ...r,
    fuel_estimated_liters: estimateFuelForDisplay(r.equipment_type, r.hours_run, r.equipment_class),
  }));
  
  const chartData = prepareChartData(recordsWithEstimates);
  const totalFuel = recordsWithEstimates.reduce((sum, r) => sum + (r.fuel_estimated_liters || 0), 0);
  const avgDailyFuel = chartData.length > 0 ? totalFuel / chartData.length : 0;

  return (
    <div className="space-y-6">
      {/* AI Analysis Button */}
      <Card className="bg-gradient-to-r from-blue-500/5 to-cyan-500/10 border-blue-500/20">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-lg sm:text-xl">
                Fuel Analysis
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Detect anomalies, spikes, and optimization opportunities
              </CardDescription>
            </div>
            <Button 
              onClick={handleAIAnalysis} 
              disabled={loadingAI || equipmentRecords.length === 0}
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
        {aiInsights && aiInsights.equipment_fuel_plan && aiInsights.equipment_fuel_plan.length > 0 ? (
          <CardContent>
            <div className="space-y-4">
              {/* Equipment Fuel Plan */}
              <div className="space-y-3">
                <h4 className="font-semibold text-sm flex items-center gap-2">
                  <Fuel className="h-4 w-4" />
                  Equipment Fuel Plan ({aiInsights.equipment_fuel_plan.length} records)
                </h4>
                <div className="max-h-[500px] overflow-y-auto overflow-x-auto -mx-4 sm:mx-0">
                  <Table className="text-xs sm:text-sm">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="whitespace-nowrap">Date</TableHead>
                        <TableHead className="whitespace-nowrap">Equipment</TableHead>
                        <TableHead className="whitespace-nowrap hidden sm:table-cell">Class</TableHead>
                        <TableHead className="text-right whitespace-nowrap">Hours</TableHead>
                        <TableHead className="text-right whitespace-nowrap hidden md:table-cell">Base L/hr</TableHead>
                        <TableHead className="text-right whitespace-nowrap hidden md:table-cell">Effective L/hr</TableHead>
                        <TableHead className="text-right whitespace-nowrap">Fuel (L)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {aiInsights.equipment_fuel_plan.map((plan: any, idx: number) => (
                        <TableRow key={idx}>
                          <TableCell className="font-medium whitespace-nowrap">
                            {fuelDateLabel(plan.date)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{plan.equipment_id}</TableCell>
                          <TableCell className="text-muted-foreground whitespace-nowrap hidden sm:table-cell">
                            {plan.equipment_class || plan.equipment_type}
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">{plan.hours_run?.toFixed(1)}</TableCell>
                          <TableCell className="text-right whitespace-nowrap hidden md:table-cell">{plan.base_lph?.toFixed(1)}</TableCell>
                          <TableCell className="text-right whitespace-nowrap hidden md:table-cell">{plan.effective_lph?.toFixed(1)}</TableCell>
                          <TableCell className="text-right font-semibold whitespace-nowrap">
                            {plan.fuel_burn_liters?.toFixed(1)}L
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          </CardContent>
        ) : aiInsights ? (
          <CardContent>
            <p className="text-sm text-muted-foreground">No fuel plan data available</p>
          </CardContent>
        ) : null}
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        <Card>
          <CardHeader className="pb-2 px-4 pt-4 sm:px-6 sm:pt-6">
            <CardDescription className="text-xs">Total Equipment</CardDescription>
            <CardTitle className="text-xl sm:text-2xl">{new Set(equipmentRecords.map(r => r.equipment_id)).size}</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 sm:px-6 sm:pb-6">
            <p className="text-xs text-muted-foreground">unique equipment units</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 px-4 pt-4 sm:px-6 sm:pt-6">
            <CardDescription className="text-xs">Total Fuel Estimated</CardDescription>
            <CardTitle className="text-xl sm:text-2xl">{Math.round(totalFuel)}L</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 sm:px-6 sm:pb-6">
            <p className="text-xs text-muted-foreground">across all equipment</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 px-4 pt-4 sm:px-6 sm:pt-6">
            <CardDescription className="text-xs">Avg Daily Fuel</CardDescription>
            <CardTitle className="text-xl sm:text-2xl">{Math.round(avgDailyFuel)}L</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 sm:px-6 sm:pb-6">
            <p className="text-xs text-muted-foreground">per day average</p>
          </CardContent>
        </Card>
      </div>

      {/* Fuel Curve Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader className="px-4 pt-4 sm:px-6 sm:pt-6">
            <CardTitle className="text-base sm:text-lg">Daily Fuel Consumption Curve</CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Estimated fuel usage by equipment type over time
            </CardDescription>
          </CardHeader>
          <CardContent className="px-2 pb-4 sm:px-6 sm:pb-6">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="date" 
                  tick={{ fontSize: 10 }}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                />
                <YAxis 
                  label={{ value: "Fuel (L)", angle: -90, position: "insideLeft", style: { fontSize: 10 } }}
                  tick={{ fontSize: 10 }}
                />
                <Tooltip 
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-background border border-border p-2 rounded-lg shadow-lg text-xs">
                          <p className="font-semibold">{payload[0].payload.fullDate}</p>
                          {payload.map((entry: any, idx: number) => (
                            <p key={idx} className="text-xs" style={{ color: entry.color }}>
                              {entry.name}: {Math.round(entry.value)}L
                            </p>
                          ))}
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Line 
                  type="monotone" 
                  dataKey="totalFuel" 
                  name="Total Fuel"
                  stroke="hsl(var(--primary))" 
                  strokeWidth={2}
                  dot={{ fill: "hsl(var(--primary))", r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Equipment Details Table */}
      <Card>
        <CardHeader className="px-4 pt-4 sm:px-6 sm:pt-6">
          <CardTitle className="text-base sm:text-lg">Equipment Usage Details</CardTitle>
          <CardDescription className="text-xs sm:text-sm">Daily equipment fuel consumption breakdown</CardDescription>
        </CardHeader>
        <CardContent className="px-0 sm:px-6 pb-4 sm:pb-6">
          <div className="max-h-[400px] overflow-y-auto overflow-x-auto">
            <Table className="text-xs sm:text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">Date</TableHead>
                  <TableHead className="whitespace-nowrap">Equipment</TableHead>
                  <TableHead className="whitespace-nowrap hidden sm:table-cell">Type</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Hours</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Fuel (L)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recordsWithEstimates.slice(0, 50).map((record, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-medium whitespace-nowrap">
                      {fuelDateLabel(record.date)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{record.equipment_id}</TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap hidden sm:table-cell">{record.equipment_type}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{record.hours_run?.toFixed(1)}</TableCell>
                    <TableCell className="text-right font-semibold whitespace-nowrap">
                      {record.fuel_estimated_liters?.toFixed(1)}L
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// Fuel consumption rates (liters per hour) - stored for consistent use across the app
// These match the rates used by the AI edge function
const EQUIPMENT_FUEL_RATES: Record<string, number> = {
  // Excavators by class
  'mini_excavator': 5,
  'small_excavator': 10,
  'medium_excavator': 15,
  'large_excavator': 22,
  'heavy_excavator': 30,
  // Dozers by class
  'small_dozer': 10,
  'medium_dozer': 16,
  'large_dozer': 30,
  'ultra_dozer': 50,
  // Other equipment
  'skid_steer': 8,
  'telehandler': 10,
  'crew_truck': 3,
  'dump_truck': 6,
  'generator': 2.5,
  'compressor': 3,
  'pump': 2,
  'crane': 20,
  'grinder': 2.5,
  'swing_stage': 1.5,
  'general_equipment': 4,
};

// Helper functions
// List of electric/manual tools that don't consume fuel
const NON_FUEL_EQUIPMENT = new Set([
  'wire puller', 'wire pullers', 'drill', 'drills', 'power tool', 'power tools',
  'grinder', 'saw', 'saws', 'welder', 'welders', 'torch', 'impact wrench',
  'hand tool', 'hand tools', 'ladder', 'ladders', 'scaffolding', 'multimeter',
  'diagnostic tool', 'diagnostic tools', 'test equipment', 'gauges', 'gauge',
  'pressure washer', 'jackhammer', 'concrete saw', 'nail gun', 'air tools',
  'pipe threader', 'pipe threaders', 'threading machine',
]);

function isNonFuelEquipment(equipmentName: string): boolean {
  const name = equipmentName.toLowerCase().trim();
  return NON_FUEL_EQUIPMENT.has(name) || 
         Array.from(NON_FUEL_EQUIPMENT).some(tool => name.includes(tool));
}

// Parse equipment name to extract all details for AI classification
function parseEquipmentName(equipmentName: string): {
  quantity: number;
  type: string;
  equipment_class?: string;
  model_name?: string;
  tonnage?: number;
  isNonFuel?: boolean;
} {
  const original = equipmentName;
  let name = equipmentName.toLowerCase();
  
  // Extract quantity (e.g., "5 D6 dozers" -> 5)
  let quantity = 1;
  const quantityMatch = name.match(/^(\d+)\s+(.+)$/);
  if (quantityMatch) {
    quantity = parseInt(quantityMatch[1], 10);
    name = quantityMatch[2];
  }
  
  // Extract tonnage (e.g., "22 ton excavator" or "22-ton excavator")
  let tonnage: number | undefined;
  const tonnageMatch = name.match(/(\d+)[-\s]?ton/);
  if (tonnageMatch) {
    tonnage = parseInt(tonnageMatch[1], 10);
  }
  
  // Extract model name (preserve case from original)
  let model_name: string | undefined;
  
  // Check for Cat models (e.g., "Cat 320GC", "CAT D6")
  const catMatch = original.match(/cat\s*(\w+)/i);
  if (catMatch) {
    model_name = catMatch[1];
  }
  
  // Check for model numbers in equipment name (D3, D4, D5, D6, D7, D8, D9, D10, 320, 330, etc.)
  const modelMatch = original.match(/\b(D\d{1,2}|\d{3,4}[A-Z]*)\b/i);
  if (modelMatch && !model_name) {
    model_name = modelMatch[1];
  }
  
  // Determine equipment type and class
  let type = 'general equipment';
  let equipment_class: string | undefined;
  
  if (name.includes('excavator') || name.includes('digger')) {
    type = 'excavator';
    // AI will classify based on tonnage/model
  } else if (name.includes('dozer') || /\bd[3-9]\b|\bd10\b/.test(name)) {
    type = 'dozer';
    // Classify dozer size based on model
    if (model_name) {
      const model = model_name.toUpperCase();
      if (model === 'D3' || model === 'D4') equipment_class = 'small_dozer';
      else if (model === 'D5' || model === 'D6') equipment_class = 'medium_dozer';
      else if (model === 'D7' || model === 'D8') equipment_class = 'large_dozer';
      else if (model === 'D9' || model === 'D10') equipment_class = 'ultra_dozer';
    }
  } else if (name.includes('skid') || name.includes('bobcat')) {
    type = 'skid steer';
    equipment_class = 'skid_steer';
  } else if (name.includes('telehandler') || name.includes('forklift') || name.includes('zoom boom')) {
    type = 'telehandler';
    equipment_class = 'telehandler';
  } else if (name.includes('truck')) {
    if (name.includes('dump') || name.includes('tandem')) {
      type = 'dump truck';
      equipment_class = 'dump_truck';
    } else {
      type = 'crew truck';
      equipment_class = 'crew_truck';
    }
  } else if (name.includes('generator') || name.includes('gen')) {
    type = 'generator';
  } else if (name.includes('compressor')) {
    type = 'compressor';
  } else if (name.includes('pump')) {
    type = 'pump';
  } else if (name.includes('crane')) {
    type = 'crane';
  } else if (name.includes('grinder') || name.includes('grinding')) {
    type = 'grinder';
    equipment_class = 'grinder';
  } else if (name.includes('swing stage') || name.includes('swing-stage')) {
    type = 'swing stage';
    equipment_class = 'swing_stage';
  }
  
  return {
    quantity,
    type,
    equipment_class,
    model_name,
    tonnage,
    isNonFuel: isNonFuelEquipment(equipmentName),
  };
}

// Estimate fuel for display purposes (before AI analysis)
// Uses equipment_class if available, otherwise falls back to equipment_type
function estimateFuelForDisplay(equipmentType: string, hours: number, equipmentClass?: string): number {
  // First try to use the specific equipment class
  if (equipmentClass && EQUIPMENT_FUEL_RATES[equipmentClass]) {
    const baseLph = EQUIPMENT_FUEL_RATES[equipmentClass];
    // Apply idle adjustment (30% idle time at 40% fuel consumption)
    const idleRatio = 0.30;
    const effectiveLph = baseLph * ((1 - idleRatio) + idleRatio * 0.40);
    return effectiveLph * hours;
  }
  
  // Fallback to generic type-based rates
  const type = equipmentType.toLowerCase();
  let baseLph = EQUIPMENT_FUEL_RATES.general_equipment;
  
  if (type.includes('excavator')) {
    baseLph = EQUIPMENT_FUEL_RATES.medium_excavator; // default to medium
  } else if (type.includes('dozer')) {
    baseLph = EQUIPMENT_FUEL_RATES.medium_dozer; // default to medium
  } else if (type.includes('skid') || type.includes('bobcat')) {
    baseLph = EQUIPMENT_FUEL_RATES.skid_steer;
  } else if (type.includes('telehandler') || type.includes('forklift') || type.includes('zoom boom')) {
    baseLph = EQUIPMENT_FUEL_RATES.telehandler;
  } else if (type.includes('dump') || type.includes('tandem')) {
    baseLph = EQUIPMENT_FUEL_RATES.dump_truck;
  } else if (type.includes('truck')) {
    baseLph = EQUIPMENT_FUEL_RATES.crew_truck;
  } else if (type.includes('generator') || type.includes('gen')) {
    baseLph = EQUIPMENT_FUEL_RATES.generator;
  } else if (type.includes('compressor')) {
    baseLph = EQUIPMENT_FUEL_RATES.compressor;
  } else if (type.includes('pump')) {
    baseLph = EQUIPMENT_FUEL_RATES.pump;
  } else if (type.includes('crane')) {
    baseLph = EQUIPMENT_FUEL_RATES.crane;
  } else if (type.includes('grinder') || type.includes('grinding')) {
    baseLph = EQUIPMENT_FUEL_RATES.grinder;
  } else if (type.includes('swing stage') || type.includes('swing-stage')) {
    baseLph = EQUIPMENT_FUEL_RATES.swing_stage;
  }
  
  // Apply idle adjustment
  const idleRatio = 0.30;
  const effectiveLph = baseLph * ((1 - idleRatio) + idleRatio * 0.40);
  return effectiveLph * hours;
}

function prepareChartData(records: any[]) {
  const dailyTotals = new Map<string, number>();
  
  records.forEach(record => {
    const current = dailyTotals.get(record.date) || 0;
    const fuelValue = record.fuel_estimated_liters || record.fuel_burn_liters || 0;
    dailyTotals.set(record.date, current + fuelValue);
  });
  
  return Array.from(dailyTotals.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, totalFuel]) => ({
      date: fuelDateLabel(date),
      fullDate: fuelDateLabel(date, 'MMM d, yyyy'),
      totalFuel: Math.round(totalFuel * 10) / 10,
    }));
}
