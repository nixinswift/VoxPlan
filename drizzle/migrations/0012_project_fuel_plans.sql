CREATE TABLE public.project_fuel_plans (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  plan jsonb NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0)
);
--> statement-breakpoint
ALTER TABLE public.project_fuel_plans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.project_fuel_plans TO authenticated;
GRANT ALL ON public.project_fuel_plans TO service_role;
--> statement-breakpoint
CREATE POLICY "Approved accounts only" ON public.project_fuel_plans AS RESTRICTIVE FOR ALL TO authenticated
  USING (private.is_current_user_approved()) WITH CHECK (private.is_current_user_approved());
--> statement-breakpoint
CREATE POLICY "Members read fuel plans" ON public.project_fuel_plans FOR SELECT TO authenticated
  USING (private.is_project_member(auth.uid(), project_id));
--> statement-breakpoint
CREATE POLICY "Editors create fuel plans" ON public.project_fuel_plans FOR INSERT TO authenticated
  WITH CHECK (private.can_edit_practice_project(project_id) AND EXISTS (
    SELECT 1 FROM public.project_members pm JOIN public.projects p ON p.id = pm.project_id
    WHERE pm.project_id = project_fuel_plans.project_id AND pm.user_id = auth.uid()
      AND pm.role IN ('owner', 'editor') AND p.is_demo = false
  ));
--> statement-breakpoint
CREATE POLICY "Editors update fuel plans" ON public.project_fuel_plans FOR UPDATE TO authenticated
  USING (private.can_edit_practice_project(project_id) AND EXISTS (
    SELECT 1 FROM public.project_members pm JOIN public.projects p ON p.id = pm.project_id
    WHERE pm.project_id = project_fuel_plans.project_id AND pm.user_id = auth.uid()
      AND pm.role IN ('owner', 'editor') AND p.is_demo = false
  ));
