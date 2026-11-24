-- Drop the problematic policies that cause infinite recursion
DROP POLICY IF EXISTS "Users can view project members for their projects" ON public.project_members;
DROP POLICY IF EXISTS "Project owners can manage members" ON public.project_members;

-- Create security definer functions to check membership without triggering RLS recursion
CREATE OR REPLACE FUNCTION public.is_project_member(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_members
    WHERE user_id = _user_id
    AND project_id = _project_id
  )
$$;

CREATE OR REPLACE FUNCTION public.is_project_owner(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_members
    WHERE user_id = _user_id
    AND project_id = _project_id
    AND role = 'owner'
  )
$$;

-- Recreate policies using the security definer functions
CREATE POLICY "Users can view project members for their projects"
ON public.project_members
FOR SELECT
USING (public.is_project_member(auth.uid(), project_id));

CREATE POLICY "Project owners can insert members"
ON public.project_members
FOR INSERT
WITH CHECK (public.is_project_owner(auth.uid(), project_id));

CREATE POLICY "Project owners can update members"
ON public.project_members
FOR UPDATE
USING (public.is_project_owner(auth.uid(), project_id));

CREATE POLICY "Project owners can delete members"
ON public.project_members
FOR DELETE
USING (public.is_project_owner(auth.uid(), project_id));