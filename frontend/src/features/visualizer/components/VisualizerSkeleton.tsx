export function VisualizerSkeleton() {
  return (
    <div className="relative h-full bg-neutral-800 overflow-hidden">
      {/* Dot Matrix Background */}
      <div
        className="absolute inset-0 opacity-50"
        style={{
          backgroundImage: `radial-gradient(circle, #3B3B3B 1px, transparent 1px)`,
          backgroundSize: '12px 12px',
        }}
      />

      {/* Loading content */}
      <div className="relative z-10 flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="inline-flex items-center gap-3 text-white">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-lg font-medium">Loading schema visualization...</span>
          </div>
        </div>
      </div>
    </div>
  );
}
