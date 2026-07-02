import { GoalsClient } from "@/components/goals-client";

export default function StrategyActionsPage({
  searchParams
}: {
  searchParams: { week?: string };
}) {
  return <GoalsClient view="actions" initialWeekStart={searchParams.week} />;
}
