-- Server-side registration gate: only emails present in public.approved_users may create an account.
-- Client-side pre-check helper (approved_users itself stays admin/self-only under RLS).
CREATE OR REPLACE FUNCTION public.is_email_approved(_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.approved_users
    WHERE lower(email) = lower(trim(_email))
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_email_approved(text) TO anon, authenticated;

-- Hard enforcement at the database layer so no client bypass (API, magic link, OAuth) can register an unapproved email.
CREATE OR REPLACE FUNCTION private.enforce_approved_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.approved_users
    WHERE lower(email) = lower(trim(NEW.email))
  ) THEN
    RAISE EXCEPTION 'This email is not approved for registration. Contact your VoxPlan administrator.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_approved_signup ON auth.users;
CREATE TRIGGER enforce_approved_signup
BEFORE INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION private.enforce_approved_signup();