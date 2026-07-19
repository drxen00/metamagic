export default function Template({ children }: { children: React.ReactNode }) {
  // Opacity-only: a transform here would become the containing block for
  // fixed-position overlays (drawers, dialogs) and break their placement.
  return <div className="animate-fade-in">{children}</div>;
}
