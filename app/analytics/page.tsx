import { PageHeader } from "@/components/page-header";
import { ReportsClient } from "@/components/reports-client";

export default function AnalyticsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Аналитика"
        description="Отчеты, категории расходов, динамика и утечки денег."
      />
      <ReportsClient />
    </div>
  );
}
