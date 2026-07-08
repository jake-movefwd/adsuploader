import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import UploadUI from "@/components/UploadUI";
import Header from "@/components/Header";

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/login");
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8">
      <Header userName={session.user?.name ?? null} />
      <UploadUI />
    </main>
  );
}
