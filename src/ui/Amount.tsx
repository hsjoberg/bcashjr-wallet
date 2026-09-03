import { createContext, type ReactNode, useContext } from "react";
import type { AmountUnit } from "../core/types.ts";
import { formatAmount } from "./shared.tsx";

const AmountUnitContext = createContext<AmountUnit | null>(null);

export function Amount({ value }: { value: number }) {
  const unit = useContext(AmountUnitContext);
  if (!unit) throw new Error("Amount denomination is unavailable");
  return <>{formatAmount(value, unit)}</>;
}

export function AmountUnitProvider(
  { unit, children }: { unit: AmountUnit; children: ReactNode },
) {
  return <AmountUnitContext.Provider value={unit}>{children}</AmountUnitContext.Provider>;
}
