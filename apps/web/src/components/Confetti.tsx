const COLOURS = ["#ff3d81", "#2ec4ff", "#9be564", "#ffd23f", "#ffffff", "#b388ff"];

/** A short burst of paper from the top of the screen. Purely decorative; it never blocks a click. */
export function Confetti({ pieces = 36 }: { pieces?: number }) {
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: pieces }, (_, i) => (
        <i
          // biome-ignore lint/suspicious/noArrayIndexKey: identical decorative pieces
          key={i}
          style={{
            left: `${(i * 37) % 100}%`,
            background: COLOURS[i % COLOURS.length],
            animationDelay: `${(i % 9) * 0.12}s`,
            animationDuration: `${2 + (i % 5) * 0.35}s`,
          }}
        />
      ))}
    </div>
  );
}
