import { Task } from "@/types/schedule";
import { Card } from "@/components/ui/card";
import { Trash2, Users, Wrench, Calendar, Edit } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TaskRowProps {
  task: Task;
  onDelete: (id: string) => void;
  onEdit: (task: Task) => void;
  isSubtask?: boolean;
}

const tradeColorMap: Record<Task["trade"], string> = {
  electrical: "border-l-4 border-l-trade-electrical",
  mechanical: "border-l-4 border-l-trade-mechanical",
  plumbing: "border-l-4 border-l-trade-plumbing",
  structural: "border-l-4 border-l-trade-structural",
  finishes: "border-l-4 border-l-trade-finishes",
  general: "border-l-4 border-l-trade-general",
  asbestos_abatement: "border-l-4 border-l-yellow-500",
  demolition: "border-l-4 border-l-red-600",
  concrete_construction: "border-l-4 border-l-blue-600",
  concrete_pour: "border-l-4 border-l-blue-700",
  concrete_cutting: "border-l-4 border-l-blue-500",
  concrete_grinding: "border-l-4 border-l-blue-400",
  concrete_finishing: "border-l-4 border-l-blue-800",
  rebar: "border-l-4 border-l-amber-700",
  formwork: "border-l-4 border-l-teal-600",
  civil: "border-l-4 border-l-emerald-600",
};

export const TaskRow = ({ task, onDelete, onEdit, isSubtask }: TaskRowProps) => {
  const endDate = new Date(task.startDate);
  endDate.setDate(endDate.getDate() + task.duration);

  return (
    <Card className={`p-4 ${tradeColorMap[task.trade]} ${isSubtask ? 'bg-muted/50' : ''}`}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className={`font-semibold truncate ${isSubtask ? 'text-base' : 'text-lg'}`}>
            {isSubtask && '└─ '}
            {task.name}
          </h3>
          <p className="text-sm text-muted-foreground capitalize">{task.trade}</p>
        </div>

        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{task.manpower}</span>
          </div>

          <div className="flex items-center gap-2 min-w-[120px]">
            <Wrench className="h-4 w-4 text-muted-foreground" />
            <span className="truncate">{task.equipment || "None"}</span>
          </div>

          <div className="flex items-center gap-2 min-w-[100px]">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span>{task.duration}d</span>
          </div>

          <div className="text-sm text-muted-foreground min-w-[180px]">
            {task.startDate.toLocaleDateString()} - {endDate.toLocaleDateString()}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onEdit(task)}
            className="hover:bg-primary hover:text-primary-foreground"
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDelete(task.id)}
            className="hover:bg-destructive hover:text-destructive-foreground"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
};
