import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Orbitron, Space_Grotesk, VT323 } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Sidebar } from "@/components/shell/sidebar";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-grotesk" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
const orbitron = Orbitron({ subsets: ["latin"], variable: "--font-orbitron" });
const vt323 = VT323({ weight: "400", subsets: ["latin"], variable: "--font-vt323" });

export const metadata: Metadata = {
  title: "MetaMagic",
  description: "Plex library manager with granular control and mass operations",
};

const themeInit = `
try {
  var t = localStorage.getItem("metamagic-theme");
  if (t) document.documentElement.dataset.theme = t;
  var f = localStorage.getItem("metamagic-font");
  if (f) document.documentElement.dataset.font = f;
  if (localStorage.getItem("metamagic-sidebar") === "collapsed") {
    document.documentElement.dataset.sidebar = "collapsed";
  }
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`dark ${inter.variable} ${grotesk.variable} ${mono.variable} ${orbitron.variable} ${vt323.variable}`}
      suppressHydrationWarning
    >
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <Providers>
          <Sidebar />
          <div
            className="transition-[padding-left] duration-300 ease-out"
            style={{ paddingLeft: "var(--sidebar-w)" }}
          >
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
