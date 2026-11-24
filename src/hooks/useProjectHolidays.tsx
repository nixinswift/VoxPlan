import { useState, useEffect } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

export interface Holiday {
  id: string;
  date: string;
  name: string | null;
}

export const useProjectHolidays = (projectId: string | undefined) => {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let current = true;
    setError(false);
    if (!projectId) {
      setHolidays([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setHolidays([]);
    const fetchHolidays = async () => {
      const { data, error } = await supabase
        .from("project_holidays")
        .select("id, date, name")
        .eq("project_id", projectId)
        .order("date");

      if (!current) return;
      setError(Boolean(error));
      if (!error && data) {
        setHolidays(data);
      }
      setLoading(false);
    };

    fetchHolidays();
    return () => { current = false; };
  }, [projectId]);

  const isHoliday = (date: Date): boolean => {
    const dateStr = format(date, "yyyy-MM-dd");
    return holidays.some(h => h.date === dateStr);
  };

  const getHolidayName = (date: Date): string | null => {
    const dateStr = format(date, "yyyy-MM-dd");
    const holiday = holidays.find(h => h.date === dateStr);
    return holiday?.name || null;
  };

  return { holidays, loading, error, isHoliday, getHolidayName };
};
