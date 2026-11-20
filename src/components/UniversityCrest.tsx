interface LogoProps {
  height?: number;
  size?: number;
  className?: string;
}

export function UniversityCrest({ height, size, className = '' }: LogoProps) {
  const h = height ?? size ?? 38;
  return (
    <span className={`inline-flex items-center bg-white px-1.5 py-0.5 shrink-0 ${className}`}>
      <img
        src="/assets/aistudio/image_9c337579.png"
        alt="Aditya University Logo"
        style={{ height: `${h}px`, width: 'auto' }}
        className="object-contain block"
      />
    </span>
  );
}
