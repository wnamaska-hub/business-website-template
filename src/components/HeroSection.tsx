import GlobeLoader from "@/components/globe/GlobeLoader";

export default function HeroSection() {
  return (
    <section className="relative min-h-screen overflow-hidden bg-[#020617] flex items-center">
      {/* Globe — absolutely positioned behind content, non-interactive */}
      <div className="absolute inset-0">
        <GlobeLoader />
      </div>

      {/* Gradient overlay keeps text readable over the globe */}
      <div className="absolute inset-0 bg-gradient-to-r from-[#020617] via-[#020617]/80 to-[#020617]/20 pointer-events-none" />

      <div className="relative z-10 w-full max-w-7xl mx-auto px-6 lg:px-12 py-24">
        <div className="max-w-xl flex flex-col gap-6">
          <p className="text-sm font-medium uppercase tracking-widest text-cyan-400">
            Global Technology Solutions
          </p>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight tracking-tight text-white">
            Engineering the
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-teal-300">
              future of software
            </span>
          </h1>

          <p className="text-lg text-zinc-400 leading-relaxed max-w-md">
            We build reliable, scalable platforms that power businesses across
            every continent. Let&apos;s turn your vision into production-grade
            reality.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 mt-2">
            <a
              href="#contact"
              className="inline-flex h-12 items-center justify-center rounded-full bg-cyan-500 px-8 text-sm font-semibold text-[#020617] transition-colors hover:bg-cyan-400"
            >
              Get in touch
            </a>
            <a
              href="#services"
              className="inline-flex h-12 items-center justify-center rounded-full border border-white/15 px-8 text-sm font-semibold text-white transition-colors hover:bg-white/5"
            >
              Our services
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
