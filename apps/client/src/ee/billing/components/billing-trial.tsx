import { Alert } from "@mantine/core";
import { useBillingQuery } from "@/ee/billing/queries/billing-query.ts";
import useTrial from "@/ee/hooks/use-trial.tsx";
import { getBillingTrialDays } from '@/lib/config.ts';

export default function BillingTrial() {
  // Return null to hide all trial-related alerts
  return null;

  // ... rest of the code (commented out or removed) ...
}
