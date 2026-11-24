ALTER TABLE public.tasks ADD COLUMN predecessor_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];
COMMENT ON COLUMN public.tasks.predecessor_ids IS 'Explicit finish-to-start task dependencies. parent_id is hierarchy only, never a scheduling dependency.';
ALTER TABLE public.tasks ADD CONSTRAINT tasks_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id) NOT VALID;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_not_own_predecessor CHECK (NOT (id = ANY(predecessor_ids))) NOT VALID;