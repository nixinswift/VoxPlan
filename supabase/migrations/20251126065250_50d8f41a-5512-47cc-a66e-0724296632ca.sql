-- Add is_demo column to projects table
ALTER TABLE public.projects
ADD COLUMN is_demo boolean DEFAULT false NOT NULL;

-- Update RLS policy on projects to show demo projects
DROP POLICY IF EXISTS "Users can view projects they are members of or admins can view all" ON public.projects;

CREATE POLICY "Users can view their projects, demo projects, or admins view all"
ON public.projects
FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR is_demo = true 
  OR EXISTS (
    SELECT 1
    FROM project_members
    WHERE project_members.project_id = projects.id 
    AND project_members.user_id = auth.uid()
  )
);

-- Update tasks RLS to prevent editing demo project tasks
DROP POLICY IF EXISTS "Users can insert tasks in their projects" ON public.tasks;
DROP POLICY IF EXISTS "Users can update tasks in their projects" ON public.tasks;
DROP POLICY IF EXISTS "Users can delete tasks in their projects" ON public.tasks;

CREATE POLICY "Users can insert tasks in non-demo projects"
ON public.tasks
FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) 
  OR (
    EXISTS (
      SELECT 1
      FROM project_members
      JOIN projects ON projects.id = project_members.project_id
      WHERE project_members.project_id = tasks.project_id 
      AND project_members.user_id = auth.uid() 
      AND project_members.role IN ('owner', 'editor')
      AND projects.is_demo = false
    )
  )
);

CREATE POLICY "Users can update tasks in non-demo projects"
ON public.tasks
FOR UPDATE
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR (
    EXISTS (
      SELECT 1
      FROM project_members
      JOIN projects ON projects.id = project_members.project_id
      WHERE project_members.project_id = tasks.project_id 
      AND project_members.user_id = auth.uid() 
      AND project_members.role IN ('owner', 'editor')
      AND projects.is_demo = false
    )
  )
);

CREATE POLICY "Users can delete tasks in non-demo projects"
ON public.tasks
FOR DELETE
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR (
    EXISTS (
      SELECT 1
      FROM project_members
      JOIN projects ON projects.id = project_members.project_id
      WHERE project_members.project_id = tasks.project_id 
      AND project_members.user_id = auth.uid() 
      AND project_members.role IN ('owner', 'editor')
      AND projects.is_demo = false
    )
  )
);