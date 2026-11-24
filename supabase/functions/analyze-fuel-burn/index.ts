import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { calculateFuelDuty } from "../_shared/fuel-duty.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Content-Type": "application/json",
};

const numeric = z.number().finite().nullable();
const text = z.string().max(2000);
const state = z.object({ hours: numeric, litresPerHour: numeric });
const dutySchema = z.object({
  fuelType: z.enum(["", "diesel", "non-diesel"]),
  model: text, engine: text, temperatureC: numeric, conditions: text, source: text, sourceDate: text,
  shiftHours: numeric, productiveHours: numeric,
  states: z.object({ idle: state, light: state, moderate: state, heavy: state, warmUp: state }),
  billing: z.enum(["", "included", "separate"]),
});

const requestSchema = z.object({
  equipmentData: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    equipment_id: text,
    equipment_type: text,
    equipment_class: text.optional(),
    quantity: z.number().int().positive().safe().default(1),
    duty: dutySchema.optional(),
  })).max(1000),
});

serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { headers });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response(JSON.stringify({ error: "Invalid equipment records" }), { status: 400, headers });

  const equipment_fuel_plan = parsed.data.equipmentData.map(({ duty, ...equipment }) => {
    const result = calculateFuelDuty(duty);
    const documented = result.status === "DOCUMENTED";
    // Legacy class names, base rates and aggregate hours alone are insufficient evidence.
    return {
      ...equipment,
      status: result.status,
      reason: documented ? null : result.reason,
      hours_run: documented ? result.engineHours * equipment.quantity : null,
      effective_lph: documented ? result.litres / result.engineHours : null,
      fuel_burn_liters: documented ? result.litres * equipment.quantity : null,
    };
  });
  return new Response(JSON.stringify({ equipment_fuel_plan }), { headers });
});
