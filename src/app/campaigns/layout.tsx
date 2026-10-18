import OwnerOnly from "@/components/owner-only";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <OwnerOnly>{children}</OwnerOnly>;
}
