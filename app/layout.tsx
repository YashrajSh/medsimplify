import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MedSimplify — Medical reports, made understandable",
  description: "A private, source-grounded explanation of anonymized medical reports.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
