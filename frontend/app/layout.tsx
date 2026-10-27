import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";

export const metadata: Metadata = {
  title: "APAAR Verify — Academic Records",
  description: "A prototype workspace for student record management and explainable change review.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-theme="light" suppressHydrationWarning><body>
    <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem("apaar_theme");document.documentElement.dataset.theme=t==="dark"?"dark":"light"}catch(e){document.documentElement.dataset.theme="light"}` }} />
    <AuthProvider>{children}</AuthProvider>
  </body></html>;
}
