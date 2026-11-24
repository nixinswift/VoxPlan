import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

/** Signs out any session whose email is no longer on the approved list (checked on load and every sign-in/refresh). */
export function ApprovalGuard() {
  useEffect(() => {
    const check = async (userId?: string) => {
      if (!userId) return;
      const { data, error } = await supabase.rpc("am_i_approved");
      if (!error && data === false) {
        await supabase.auth.signOut();
        toast({
          title: "Access removed",
          description: "This email is no longer approved for VoxPlan. Contact your VoxPlan administrator.",
          variant: "destructive",
        });
        if (!window.location.pathname.startsWith("/auth")) window.location.assign("/auth");
      }
    };
    supabase.auth.getSession().then(({ data }) => check(data.session?.user.id));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") setTimeout(() => check(session?.user.id), 0);
    });
    return () => subscription.unsubscribe();
  }, []);
  return null;
}
