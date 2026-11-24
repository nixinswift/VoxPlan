-- Approval is checked on every request, so removing someone from approved_users blocks an existing session immediately.
CREATE OR REPLACE FUNCTION private.is_current_user_approved()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
    JOIN public.approved_users a ON lower(a.email) = lower(u.email)
    WHERE u.id = auth.uid()
  );
$$;
GRANT EXECUTE ON FUNCTION private.is_current_user_approved() TO authenticated;

CREATE OR REPLACE FUNCTION public.am_i_approved()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$ SELECT private.is_current_user_approved(); $$;
GRANT EXECUTE ON FUNCTION public.am_i_approved() TO authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_roles','project_cost_rates','project_cost_settings','project_specs','project_cost_proposals','estimates','projects','project_members','approved_users','tasks','rotation_schedule','project_holidays','rotation_settings','global_shifts','project_shifts']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Approved accounts only" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Approved accounts only" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (private.is_current_user_approved()) WITH CHECK (private.is_current_user_approved())', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Approved accounts only" ON storage.objects;
CREATE POLICY "Approved accounts only" ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
USING (private.is_current_user_approved()) WITH CHECK (private.is_current_user_approved());