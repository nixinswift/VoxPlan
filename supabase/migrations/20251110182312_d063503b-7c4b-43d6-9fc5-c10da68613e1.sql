-- Drop existing policies
DROP POLICY IF EXISTS "Users can view tasks in their projects" ON tasks;
DROP POLICY IF EXISTS "Users can insert tasks in their projects" ON tasks;
DROP POLICY IF EXISTS "Users can update tasks in their projects" ON tasks;
DROP POLICY IF EXISTS "Users can delete tasks in their projects" ON tasks;

-- Create new policies with admin access
CREATE POLICY "Users can view tasks in their projects"
ON tasks
FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role) OR
  EXISTS (
    SELECT 1
    FROM project_members
    WHERE project_members.project_id = tasks.project_id
    AND project_members.user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert tasks in their projects"
ON tasks
FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) OR
  EXISTS (
    SELECT 1
    FROM project_members
    WHERE project_members.project_id = tasks.project_id
    AND project_members.user_id = auth.uid()
    AND project_members.role = ANY(ARRAY['owner', 'editor'])
  )
);

CREATE POLICY "Users can update tasks in their projects"
ON tasks
FOR UPDATE
USING (
  has_role(auth.uid(), 'admin'::app_role) OR
  EXISTS (
    SELECT 1
    FROM project_members
    WHERE project_members.project_id = tasks.project_id
    AND project_members.user_id = auth.uid()
    AND project_members.role = ANY(ARRAY['owner', 'editor'])
  )
);

CREATE POLICY "Users can delete tasks in their projects"
ON tasks
FOR DELETE
USING (
  has_role(auth.uid(), 'admin'::app_role) OR
  EXISTS (
    SELECT 1
    FROM project_members
    WHERE project_members.project_id = tasks.project_id
    AND project_members.user_id = auth.uid()
    AND project_members.role = ANY(ARRAY['owner', 'editor'])
  )
);