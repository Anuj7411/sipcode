/**
 * Root layout for the Next.js App Router.
 */
import { Inter } from "next/font/google";
import "./globals.css";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html><body>{children}</body></html>;
}
