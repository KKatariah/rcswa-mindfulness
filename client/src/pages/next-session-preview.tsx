import Head from "next/head";
import NextSession from "@/components/modules/NextSession";
import { pageTitle } from "@/lib/pageTitle";

export default function NextSessionPreview() {
  return (
    <>
      <Head><title>{pageTitle("Next Session Preview")}</title></Head>
      <div className="min-h-screen bg-brand-blue/20 p-4">
        <div className="w-full max-w-[366px]">
          <NextSession
            moduleTitle="Module Week 3"
            startsAt="2028-10-24T10:00:00+08:00"
            dateLabel="Tue, Oct 24"
            timeLabel="10:00 AM"
          />
        </div>
      </div>
    </>
  );
}
