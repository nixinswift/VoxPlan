import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface Holiday {
  id: string;
  date: string;
  name: string | null;
}

export const useProjectHolidays = (projectId: string | undefined) => {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) {
      setHolidays([]);
      setLoading(false);
      return;
    }

    const fetchHolidays = async () => {
      const { data, error } = await supabase
        .from("project_holidays")
        .select("id, date, name")
        .eq("project_id", projectId)
        .order("date");

      if (!error && data) {
        setHolidays(data);
      }
      setLoading(false);
    };

    fetchHolidays();
  }, [projectId]);

  const isHoliday = (date: Date): boolean => {
    const dateStr = date.toISOString().split('T')[0];
    return holidays.some(h => h.date === dateStr);
  };

  const getHolidayName = (date: Date): string | null => {
    const dateStr = date.toISOString().split('T')[0];
    const holiday = holidays.find(h => h.date === dateStr);
    return holiday?.name || null;
  };

  return { holidays, loading, isHoliday, getHolidayName };
};
