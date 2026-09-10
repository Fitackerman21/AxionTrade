export function AuroraBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {/* base grid */}
      <div className="bg-grid absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_75%_65%_at_50%_40%,black_30%,transparent_100%)]" />

      {/* aurora blobs */}
      <div className="animate-float-slow absolute -top-32 left-[8%] h-[34rem] w-[34rem] rounded-full bg-brand/25 blur-[130px]" />
      <div className="animate-float-slow-2 absolute -bottom-40 right-[4%] h-[38rem] w-[38rem] rounded-full bg-gain/20 blur-[140px]" />
      <div className="animate-float-slow absolute top-[35%] left-[45%] h-[26rem] w-[26rem] rounded-full bg-[#9a6aff]/15 blur-[120px] [animation-delay:-6s]" />

      {/* vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(11,14,17,0.75)_100%)]" />
    </div>
  );
}
