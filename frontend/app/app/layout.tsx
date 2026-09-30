import { DeploymentGuard } from "../providers";
import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Clearline App",
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell><DeploymentGuard>{children}</DeploymentGuard></AppShell>;
}
