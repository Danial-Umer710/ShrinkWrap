import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ReportView from "@/components/ReportView";
import { listPrecomputed, loadPrecomputedBySlug } from "@/lib/precomputed";
import { GRADE_LABEL } from "@/lib/grades";

export const dynamicParams = false;

export function generateStaticParams() {
  return listPrecomputed().map((v) => ({ slug: v.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const report = loadPrecomputedBySlug(slug);
  if (!report) return {};
  const title = `${report.vendor} pricing history: grade ${report.grade} (${GRADE_LABEL[report.grade]}) — ShrinkWrap`;
  return { title, description: report.headline, openGraph: { title, description: report.verdict } };
}

export default async function ReportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const report = loadPrecomputedBySlug(slug);
  if (!report) notFound();

  return (
    <main className="flex-1 px-4 py-10 sm:py-16">
      <div className="max-w-4xl mx-auto flex items-center justify-between text-sm text-muted">
        <Link href="/" className="hover:text-foreground transition">
          ← ShrinkWrap
        </Link>
        <Link href="/vendors" className="hover:text-foreground transition">
          Leaderboard
        </Link>
      </div>
      <ReportView report={report} permalink={`/r/${slug}`} />
      <p className="max-w-4xl mx-auto mt-12 text-sm text-muted">
        <Link href="/" className="text-accent hover:underline">
          Check another vendor
        </Link>
      </p>
    </main>
  );
}
