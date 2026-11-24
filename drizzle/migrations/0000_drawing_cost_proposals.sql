CREATE TABLE public.project_cost_proposals (
 project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
 package text NOT NULL DEFAULT 'all',
 proposal jsonb NOT NULL DEFAULT '{}'::jsonb,
 updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_cost_proposals TO authenticated;
GRANT ALL ON public.project_cost_proposals TO service_role;
ALTER TABLE public.project_cost_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read cost proposals" ON public.project_cost_proposals FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::public.app_role) OR private.is_project_member(auth.uid(), project_id));
CREATE POLICY "Editors manage cost proposals" ON public.project_cost_proposals FOR ALL TO authenticated USING (private.has_role(auth.uid(), 'admin'::public.app_role) OR EXISTS (SELECT 1 FROM public.project_members pm JOIN public.projects p ON p.id=pm.project_id WHERE pm.project_id=project_cost_proposals.project_id AND pm.user_id=auth.uid() AND pm.role IN ('owner','editor') AND NOT p.is_demo)) WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role) OR EXISTS (SELECT 1 FROM public.project_members pm JOIN public.projects p ON p.id=pm.project_id WHERE pm.project_id=project_cost_proposals.project_id AND pm.user_id=auth.uid() AND pm.role IN ('owner','editor') AND NOT p.is_demo));