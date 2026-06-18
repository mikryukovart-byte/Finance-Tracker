import { CategoriesClient } from "@/components/categories-client";
import { SettingsClient } from "@/components/settings-client";

export default function SettingsPage() {
  return (
    <div className="space-y-8">
      <SettingsClient />
      <CategoriesClient />
    </div>
  );
}
