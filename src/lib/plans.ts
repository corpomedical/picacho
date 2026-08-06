export const PLAN_LIMITS = {
  none: 0,
  starter: 10,
  growth: 40,
  studio: 150,
  elite: 300,
} as const;

export const PLAN_LABELS = {
  none: "No active plan",
  starter: "Starter",
  growth: "Growth",
  studio: "Studio",
  elite: "Elite",
} as const;

export type PlanId = keyof typeof PLAN_LIMITS;
