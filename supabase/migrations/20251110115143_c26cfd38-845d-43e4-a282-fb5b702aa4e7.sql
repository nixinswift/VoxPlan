-- Add parent_id column to tasks table for hierarchical structure
ALTER TABLE public.tasks 
ADD COLUMN parent_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE;

-- Add index for better query performance
CREATE INDEX idx_tasks_parent_id ON public.tasks(parent_id);

-- Add comment for documentation
COMMENT ON COLUMN public.tasks.parent_id IS 'References parent task for creating subtasks/hierarchies';