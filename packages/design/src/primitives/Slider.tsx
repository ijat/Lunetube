import { clsx } from 'clsx';
import type { InputHTMLAttributes } from 'react';

export interface SliderProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'onChange' | 'value'
> {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}

export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  className,
  ...rest
}: SliderProps) {
  return (
    <input
      type="range"
      className={clsx('lu-slider', className)}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(e.currentTarget.valueAsNumber)}
      {...rest}
    />
  );
}
