import { state } from "../types/generalTypes";

export default {
  stateFormatter: (object: state[]) => {
    if (object === null) {
      return;
    }

    const temp = object.map((o: state) => ({ value: o.value, state: o.state }));

    return temp;
  },

  /**
   * Returns a semantic state for an ObjectStatus / ObjectAttribute based on stock level.
   * - amount >= 10 -> Success (green)
   * - amount > 0 and < 10 -> Warning (yellow)
   * - amount === 0 -> Error (red)
   */
  stockState: (amount: number) => {
    if (typeof amount !== 'number') return 'None';
    if (amount >= 10) return 'Success';
    if (amount > 0) return 'Warning';
    return 'Error';
  },

  /**
   * Small helper to render a human readable stock text.
   */
  stockText: (amount: number) => {
    if (typeof amount !== 'number') return '';
    if (amount <= 0) return 'Out of stock';
    return `${amount} in stock`;
  }
};
