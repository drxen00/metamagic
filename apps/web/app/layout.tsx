import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Sidebar } from "@/components/shell/sidebar";

export const metadata: Metadata = {
  title: "MetaMagic",
  description: "Plex library manager with granular control and mass operations",
};

const themeInit = `
try {
  var t = localStorage.getItem("metamagic-theme");
  if (t) document.documentElement.dataset.theme = t;
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <Providers>
          <Sidebar />
          <div className="pl-60">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
