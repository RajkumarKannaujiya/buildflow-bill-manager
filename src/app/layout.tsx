import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "J.P. PROJECTS · Bill management",
  description: "Project bill management, material records, approvals and payments for J.P. PROJECTS.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
