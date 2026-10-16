/* eslint-disable @next/next/no-img-element */
// Approved logo C: the angular blue M mark (public/brand/moneytohome-mark.png, transparent background) plus the
// wordmark and slogan as real text so they stay crisp and follow the surrounding colour scheme.
export const BRAND_NAME = "MoneyToHome";
export const BRAND_SLOGAN = "Forward, Together.";
export function BrandMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  // The mark is 369×352; keep its aspect ratio, never stretch it.
  const height = size, width = Math.round(size * 369 / 352);
  return <img src="/brand/moneytohome-mark.png" alt={BRAND_NAME} width={width} height={height} className={"select-none " + className} style={{ width, height }} draggable={false} />;
}
