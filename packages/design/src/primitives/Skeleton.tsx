import { clsx } from 'clsx';
import type { CSSProperties } from 'react';

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
}

export function Skeleton({ width = '100%', height = 16, radius, className }: SkeletonProps) {
  const style: CSSProperties = { width, height };
  if (radius !== undefined) style.borderRadius = radius;
  return <div className={clsx('lu-skeleton', className)} style={style} aria-hidden="true" />;
}
