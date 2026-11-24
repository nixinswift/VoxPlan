
-- Create storage bucket for project specs
INSERT INTO storage.buckets (id, name, public) VALUES ('project-specs', 'project-specs', false);

-- Create project_specs table to track uploaded documents and their extracted text
CREATE TABLE public.project_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_type text NOT NULL DEFAULT '',
  extracted_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_specs ENABLE ROW LEVEL SECURITY;

-- RLS: project members can view specs
CREATE POLICY "Project members can view specs"
  ON public.project_specs FOR SELECT TO authenticated
  USING (is_project_member(auth.uid(), project_id));

-- RLS: project members can insert specs
CREATE POLICY "Project members can insert specs"
  ON public.project_specs FOR INSERT TO authenticated
  WITH CHECK (is_project_member(auth.uid(), project_id));

-- RLS: project members can delete specs
CREATE POLICY "Project members can delete specs"
  ON public.project_specs FOR DELETE TO authenticated
  USING (is_project_member(auth.uid(), project_id));

-- Storage RLS policies
CREATE POLICY "Project members can upload specs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'project-specs');

CREATE POLICY "Project members can read specs"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'project-specs');

CREATE POLICY "Project members can delete specs"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'project-specs');
