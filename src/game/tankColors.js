export const DEFAULT_TANK_COLOR = 'teal';

export const TANK_COLORS = [
  { value: 'teal', label: 'Teal', hex: '#317d84' },
  { value: 'blue', label: 'Blue', hex: '#23496b' },
  { value: 'cyan', label: 'Cyan', hex: '#008ca8' },
  { value: 'green', label: 'Green', hex: '#31834a' },
  { value: 'lime', label: 'Lime', hex: '#789b32' },
  { value: 'gold', label: 'Gold', hex: '#c28a16' },
  { value: 'orange', label: 'Orange', hex: '#d97927' },
  { value: 'red', label: 'Red', hex: '#c94a4a' },
  { value: 'magenta', label: 'Magenta', hex: '#b84579' },
  { value: 'purple', label: 'Purple', hex: '#7952a3' },
  { value: 'silver', label: 'Silver', hex: '#8497a4' },
];

const TANK_COLOR_HEX_PATTERN = /^#[\da-f]{6}$/i;

export function getTankColorHex(color) {
  const presetColor = TANK_COLORS.find((tankColor) => tankColor.value === color);
  if (presetColor) return presetColor.hex;
  if (typeof color === 'string' && TANK_COLOR_HEX_PATTERN.test(color)) {
    return color;
  }
  return TANK_COLORS.find((tankColor) => tankColor.value === DEFAULT_TANK_COLOR).hex;
}
