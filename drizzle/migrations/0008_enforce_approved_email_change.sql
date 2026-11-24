-- Changing an account's email to an unapproved address is another way to create an unapproved identity.
CREATE OR REPLACE FUNCTION private.enforce_approved_email_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email AND (NEW.email IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.approved_users WHERE lower(email) = lower(trim(NEW.email))
  )) THEN
    RAISE EXCEPTION 'This email is not approved for registration. Contact your VoxPlan administrator.';
  END IF;
  IF NEW.email_change IS NOT NULL AND NEW.email_change <> '' AND NEW.email_change IS DISTINCT FROM OLD.email_change AND NOT EXISTS (
    SELECT 1 FROM public.approved_users WHERE lower(email) = lower(trim(NEW.email_change))
  ) THEN
    RAISE EXCEPTION 'This email is not approved for registration. Contact your VoxPlan administrator.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_approved_email_change ON auth.users;
CREATE TRIGGER enforce_approved_email_change
BEFORE UPDATE OF email, email_change ON auth.users
FOR EACH ROW EXECUTE FUNCTION private.enforce_approved_email_change();