import { AccountsClient } from "@/components/accounts-client";
import { LoansClient } from "@/components/loans-client";
import { PageHeader } from "@/components/page-header";

export default function WalletPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Кошелёк"
        description="Счета, карты, переводы и долги в одном разделе."
      />
      <AccountsClient />
      <LoansClient />
    </div>
  );
}
