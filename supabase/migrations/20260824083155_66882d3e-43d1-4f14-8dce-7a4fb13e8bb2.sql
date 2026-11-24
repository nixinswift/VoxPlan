ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS unit_cost NUMERIC NOT NULL DEFAULT 0;

CREATE TABLE public.project_cost_rates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'labour',
  key TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  rate NUMERIC NOT NULL DEFAULT 0,
  rate_unit TEXT NOT NULL DEFAULT 'hr',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (project_id, kind, key)
);

CREATE TABLE public.project_cost_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE,
  currency TEXT NOT NULL DEFAULT 'CAD',
  hours_per_day NUMERIC NOT NULL DEFAULT 8,
  overhead_pct NUMERIC NOT NULL DEFAULT 10,
  profit_pct NUMERIC NOT NULL DEFAULT 10,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_cost_rates TO authenticated;
GRANT ALL ON public.project_cost_rates TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_cost_settings TO authenticated;
GRANT ALL ON public.project_cost_settings TO service_role;

ALTER TABLE public.project_cost_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_cost_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view cost rates" ON public.project_cost_rates FOR SELECT TO authenticated
USING (private.has_role(auth.uid(), 'admin'::app_role) OR private.is_project_member(auth.uid(), project_id));

CREATE POLICY "Editors insert cost rates" ON public.project_cost_rates FOR INSERT TO authenticated
WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role) OR EXISTS (
  SELECT 1 FROM public.project_members pm JOIN public.projects p ON p.id = pm.project_id
  WHERE pm.project_id = project_cost_rates.project_id AND pm.user_id = auth.uid()
  AND pm.role IN ('owner','editor') AND p.is_demo = false));

CREATE POLICY "Editors update cost rates" ON public.project_cost_rates FOR UPDATE TO authenticated
USING (private.has_role(auth.uid(), 'admin'::app_role) OR EXISTS (
  SELECT 1 FROM public.project_members pm JOIN public.projects p ON p.id = pm.project_id
  WHERE pm.project_id = project_cost_rates.project_id AND pm.user_id = auth.uid()
  AND pm.role IN ('owner','editor') AND p.is_demo = false));

CREATE POLICY "Editors delete cost rates" ON public.project_cost_rates FOR DELETE TO authenticated
USING (private.has_role(auth.uid(), 'admin'::app_role) OR EXISTS (
  SELECT 1 FROM public.project_members pm JOIN public.projects p ON p.id = pm.project_id
  WHERE pm.project_id = project_cost_rates.project_id AND pm.user_id = auth.uid()
  AND pm.role IN ('owner','editor') AND p.is_demo = false));

CREATE POLICY "Members view cost settings" ON public.project_cost_settings FOR SELECT TO authenticated
USING (private.has_role(auth.uid(), 'admin'::app_role) OR private.is_project_member(auth.uid(), project_id));

CREATE POLICY "Editors insert cost settings" ON public.project_cost_settings FOR INSERT TO authenticated
WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role) OR EXISTS (
  SELECT 1 FROM public.project_members pm JOIN public.projects p ON p.id = pm.project_id
  WHERE pm.project_id = project_cost_settings.project_id AND pm.user_id = auth.uid()
  AND pm.role IN ('owner','editor') AND p.is_demo = false));

CREATE POLICY "Editors update cost settings" ON public.project_cost_settings FOR UPDATE TO authenticated
USING (private.has_role(auth.uid(), 'admin'::app_role) OR EXISTS (
  SELECT 1 FROM public.project_members pm JOIN public.projects p ON p.id = pm.project_id
  WHERE pm.project_id = project_cost_settings.project_id AND pm.user_id = auth.uid()
  AND pm.role IN ('owner','editor') AND p.is_demo = false));

CREATE TRIGGER project_cost_rates_updated_at BEFORE UPDATE ON public.project_cost_rates
FOR EACH ROW EXECUTE FUNCTION private.handle_updated_at();

CREATE TRIGGER project_cost_settings_updated_at BEFORE UPDATE ON public.project_cost_settings
FOR EACH ROW EXECUTE FUNCTION private.handle_updated_at();