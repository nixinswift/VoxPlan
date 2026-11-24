CREATE OR REPLACE FUNCTION private.record_cost_approval_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.proposal->'useInBid' = 'true'::jsonb THEN
    IF auth.uid() IS NULL OR nullif(NEW.proposal->>'approvedBasis','') IS NULL THEN
      RAISE EXCEPTION 'A reviewed approval basis and signed-in approver are required.';
    END IF;
    NEW.proposal := NEW.proposal || jsonb_build_object(
      'approvedBy', auth.uid()::text,
      'approvedAt', statement_timestamp()
    );
  ELSE
    NEW.proposal := NEW.proposal - 'approvedBy' - 'approvedAt' - 'approvedBasis';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.record_cost_approval_identity() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER record_cost_approval_identity
  BEFORE INSERT OR UPDATE OF proposal ON public.project_cost_proposals
  FOR EACH ROW EXECUTE FUNCTION private.record_cost_approval_identity();
