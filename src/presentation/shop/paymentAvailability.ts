/** Future provider work must explicitly opt in; production defaults OFF. */
export const realMoneyPurchasesEnabled = () =>
  import.meta.env.VITE_REAL_MONEY_PURCHASES_ENABLED === '1';
