import { Activity } from "lucide-react";
import { Topbar } from "@/components/shell/topbar";
import { EmptyState } from "@/components/ui/empty-state";

export default function ActivityPage() {
  return (
    <main>
      <Topbar title="Activity" />
      <div className="p-6">
        <EmptyState
          icon={Activity}
          title="Nothing here yet"
          description="Run history, scheduled task logs, and change diffs will appear here once the rules engine lands."
        />
      </div>
    </main>
  );
}
