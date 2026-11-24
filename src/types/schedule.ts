export type TradeType = 
  | "electrical" 
  | "mechanical" 
  | "plumbing" 
  | "structural" 
  | "finishes" 
  | "general"
  | "asbestos_abatement"
  | "demolition"
  | "concrete_construction"
  | "concrete_pour"
  | "concrete_cutting"
  | "concrete_grinding"
  | "concrete_finishing"
  | "rebar"
  | "formwork"
  | "civil";

export interface Task {
  id: string;
  creationId?: string;
  predecessorIds?: string[];
  name: string;
  trade: TradeType;
  manpower: number;
  equipment: string;
  duration: number; // in days
  startDate: Date;
  notes?: string;
  parentId?: string;
}

export interface ResourceSummary {
  date: Date;
  totalWorkers: number;
  equipmentList: string[];
}
