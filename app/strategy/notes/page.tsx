import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { WorkRecordsClient } from "@/components/work-records-client";

export default function StrategyNotesPage() {
  return (
    <div>
      <PageHeader
        title="Рабочие записи"
        description="Подтверждённые заметки, решения, идеи и риски из Telegram."
      />
      <Link href="/strategy" className="mb-5 inline-flex text-sm text-muted transition hover:text-ink">
        ← Стратегия
      </Link>
      <WorkRecordsClient />
    </div>
  );
}
