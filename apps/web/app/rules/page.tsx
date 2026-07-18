import { Wand2 } from "lucide-react";
import { Topbar } from "@/components/shell/topbar";
import { EmptyState } from "@/components/ui/empty-state";

export default function RulesPage() {
  return (
    <main>
      <Topbar title="Rules" />
      <div className="p-6">
        <EmptyState
          icon={Wand2}
          title="Rules engine coming soon"
          description="Build smart, Kometa-style rules with a visual filter builder — and preview exactly what will change before anything is applied."
        />
      </div>
    </main>
  );
}
