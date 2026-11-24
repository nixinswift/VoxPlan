-- Create project holidays table for non-working days
CREATE TABLE public.project_holidays (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(project_id, date)
);

-- Enable RLS
ALTER TABLE public.project_holidays ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view holidays for their projects"
ON public.project_holidays
FOR SELECT
USING (
  project_id IN (
    SELECT id FROM public.projects WHERE created_by = auth.uid()
  ) OR
  project_id IN (
    SELECT project_id FROM public.project_members WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can manage holidays for their projects"
ON public.project_holidays
FOR ALL
USING (
  project_id IN (
    SELECT id FROM public.projects WHERE created_by = auth.uid()
  )
);

-- Add index for faster lookups
CREATE INDEX idx_project_holidays_project_date ON public.project_holidays(project_id, date);