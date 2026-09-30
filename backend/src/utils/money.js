const Decimal = require('decimal.js');
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

const D = (v) => new Decimal(v === undefined || v === null || v === '' ? 0 : v);
/** Round half-up to 2 decimals and return a Decimal */
const r2 = (v) => D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
/** Money string with exactly 2 decimals, safe for DECIMAL(15,2) columns */
const money = (v) => r2(v).toFixed(2);

module.exports = { Decimal, D, r2, money };
