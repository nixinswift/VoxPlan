import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fuelPlanSchema, type ProjectFuelPlan } from "@/lib/projectFuel";

export function useProjectFuelPlan(projectId?: string) {
  const key = ["project-fuel-plan", projectId] as const;
  return useQuery({
    queryKey: key,
    enabled: Boolean(projectId),
    queryFn: async () => {
      const { data, error } = await supabase.from("project_fuel_plans")
        .select("plan,revision").eq("project_id", projectId!).maybeSingle();
      if (error) throw error;
      return data ? { plan: fuelPlanSchema.parse(data.plan) as ProjectFuelPlan, revision: data.revision } : null;
    },
  });
}

export function useSaveProjectFuelPlan(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ plan, revision }: { plan: ProjectFuelPlan; revision: number | null }) => {
      const persisted = fuelPlanSchema.parse(plan);
      const table = supabase.from("project_fuel_plans");
      const write = revision === null
        ? table.insert({ project_id: projectId, plan: persisted })
        : table.update({ plan: persisted, revision: revision + 1 }).eq("project_id", projectId).eq("revision", revision);
      const { data, error } = await write.select("plan,revision").maybeSingle();
      if (error && error.code !== "23505") throw error;
      if (!data || error) throw new Error("Fuel plan was not saved. Check edit access or reload the saved version before retrying.");
      return { plan: fuelPlanSchema.parse(data.plan) as ProjectFuelPlan, revision: data.revision };
    },
    onSuccess: data => client.setQueryData(["project-fuel-plan", projectId], data),
  });
}
