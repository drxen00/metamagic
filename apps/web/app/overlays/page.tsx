import { Layers } from "lucide-react";
import { Topbar } from "@/components/shell/topbar";
import { EmptyState } from "@/components/ui/empty-state";

export default function OverlaysPage() {
  return (
    <main>
      <Topbar title="Overlays" />
      <div className="p-6">
        <EmptyState
          icon={Layers}
          title="Overlays coming soon"
          description="Design poster overlays (resolution, HDR, ratings badges) with live preview, apply them in bulk, and restore originals any time."
        />
      </div>
    </main>
  );
}
