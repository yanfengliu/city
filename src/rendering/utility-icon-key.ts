/** The building fields the utility-problem icon depends on. */
export interface UtilityIconView {
  powered: boolean;
  watered: boolean;
  abandoned: boolean;
}

/**
 * The floating problem icon a building should show, or null for none. A LIVE
 * building missing a utility warns with ⚡ (no power), 💧 (no water), or both —
 * the actionable "fix me before I abandon" window. An abandoned building shows
 * nothing: it is already lost (rendered grey) and the advisor explains a dark
 * city, so per-building icons would just clutter the rubble. A fully served
 * building shows nothing.
 */
export function utilityIconKey(view: UtilityIconView): string | null {
  if (view.abandoned) return null;
  const needPower = !view.powered;
  const needWater = !view.watered;
  if (needPower && needWater) return '⚡💧';
  if (needPower) return '⚡';
  if (needWater) return '💧';
  return null;
}
