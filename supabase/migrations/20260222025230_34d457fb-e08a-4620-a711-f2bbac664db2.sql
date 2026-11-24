
-- Create estimates table for concrete quantity takeoff items
CREATE TABLE public.estimates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  category TEXT NOT NULL DEFAULT 'slab',
  description TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1,
  length NUMERIC NOT NULL DEFAULT 0,
  width NUMERIC NOT NULL DEFAULT 0,
  thickness NUMERIC NOT NULL DEFAULT 0,
  height NUMERIC NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'm',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.estimates ENABLE ROW LEVEL SECURITY;

-- Policies: project members can view
CREATE POLICY "Users can view estimates in their projects"
ON public.estimates FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM project_members
    WHERE project_members.project_id = estimates.project_id
    AND project_members.user_id = auth.uid()
  )
);

-- Insert: project members with owner/editor role, non-demo
CREATE POLICY "Users can insert estimates in non-demo projects"
ON public.estimates FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM project_members
    JOIN projects ON projects.id = project_members.project_id
    WHERE project_members.project_id = estimates.project_id
    AND project_members.user_id = auth.uid()
    AND project_members.role IN ('owner', 'editor')
    AND projects.is_demo = false
  )
);

-- Update
CREATE POLICY "Users can update estimates in non-demo projects"
ON public.estimates FOR UPDATE
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM project_members
    JOIN projects ON projects.id = project_members.project_id
    WHERE project_members.project_id = estimates.project_id
    AND project_members.user_id = auth.uid()
    AND project_members.role IN ('owner', 'editor')
    AND projects.is_demo = false
  )
);

-- Delete
CREATE POLICY "Users can delete estimates in non-demo projects"
ON public.estimates FOR DELETE
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM project_members
    JOIN projects ON projects.id = project_members.project_id
    WHERE project_members.project_id = estimates.project_id
    AND project_members.user_id = auth.uid()
    AND project_members.role IN ('owner', 'editor')
    AND projects.is_demo = false
  )
);

-- Trigger for updated_at
CREATE TRIGGER update_estimates_updated_at
BEFORE UPDATE ON public.estimates
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();
