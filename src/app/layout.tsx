import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zelvora | Hackathon Platform",
  description: "Hackathon project submission and evidence-based evaluation platform."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
