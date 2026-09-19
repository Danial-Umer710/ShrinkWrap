import { listPrecomputed } from "@/lib/precomputed";
import Analyzer from "@/components/Analyzer";

export default function Home() {
  const examples = listPrecomputed();
  return (
    <main className="flex-1 px-4 py-10 sm:py-16">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-2 text-sm text-muted">
          <span className="inline-block w-2 h-2 rounded-full bg-accent" />
          ShrinkWrap
        </div>
        <h1 className="text-4xl sm:text-6xl font-semibold tracking-tight mt-4 leading-[1.05]">
          Know how a vendor treats its customers <span className="text-accent">before</span> you depend on it.
        </h1>
        <p className="text-muted text-lg mt-5 max-w-2xl leading-relaxed">
          Paste any SaaS pricing page. ShrinkWrap reads five years of archived versions and shows every price hike,
          killed plan and shrunken free tier — with receipts.
        </p>
        <Analyzer examples={examples} />
      </div>
      <footer className="max-w-4xl mx-auto mt-20 text-xs text-muted flex flex-wrap gap-x-4 gap-y-1">
        <span>Data: Internet Archive Wayback Machine.</span>
        <span>Extraction: Gemini.</span>
        <span>Built with Devin at the Budapest hackathon.</span>
      </footer>
    </main>
  );
}
