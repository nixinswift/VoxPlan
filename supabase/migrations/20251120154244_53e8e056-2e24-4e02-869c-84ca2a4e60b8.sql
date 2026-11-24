-- Create approved users table for managing signup whitelist
CREATE TABLE public.approved_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  name text,
  approved_at timestamp with time zone DEFAULT now(),
  approved_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.approved_users ENABLE ROW LEVEL SECURITY;

-- Anyone can check if an email is approved (needed for signup validation)
CREATE POLICY "Anyone can check approved emails"
ON public.approved_users
FOR SELECT
USING (true);

-- Only admins can insert approved users
CREATE POLICY "Admins can insert approved users"
ON public.approved_users
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'));

-- Only admins can update approved users
CREATE POLICY "Admins can update approved users"
ON public.approved_users
FOR UPDATE
USING (has_role(auth.uid(), 'admin'));

-- Only admins can delete approved users
CREATE POLICY "Admins can delete approved users"
ON public.approved_users
FOR DELETE
USING (has_role(auth.uid(), 'admin'));

-- Create index for faster email lookups
CREATE INDEX idx_approved_users_email ON public.approved_users(email);