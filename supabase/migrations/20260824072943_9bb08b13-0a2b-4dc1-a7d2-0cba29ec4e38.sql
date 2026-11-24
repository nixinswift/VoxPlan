ALTER TABLE public.estimates
  ADD COLUMN IF NOT EXISTS discipline text NOT NULL DEFAULT 'concrete',
  ADD COLUMN IF NOT EXISTS trade text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS uom text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS unit_qty numeric NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS estimates_project_discipline_idx ON public.estimates (project_id, discipline);

UPDATE public.estimates SET discipline = 'concrete' WHERE discipline IS NULL OR discipline = '';