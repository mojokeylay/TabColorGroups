export interface GroupColor {
	key: string;
	label: string;
	swatch: string;
	themeColorId: string;
}

export const COLOR_PALETTE: GroupColor[] = [
	{ key: 'blue', label: 'Blue', swatch: '🔵', themeColorId: 'charts.blue' },
	{ key: 'red', label: 'Red', swatch: '🔴', themeColorId: 'charts.red' },
	{ key: 'yellow', label: 'Yellow', swatch: '🟡', themeColorId: 'charts.yellow' },
	{ key: 'green', label: 'Green', swatch: '🟢', themeColorId: 'charts.green' },
	{ key: 'purple', label: 'Purple', swatch: '🟣', themeColorId: 'charts.purple' },
];

export function getColor(key: string): GroupColor {
	return COLOR_PALETTE.find(c => c.key === key) ?? COLOR_PALETTE[0];
}

export function nextColorKey(usedKeys: string[]): string {
	const unused = COLOR_PALETTE.find(c => !usedKeys.includes(c.key));
	return (unused ?? COLOR_PALETTE[usedKeys.length % COLOR_PALETTE.length]).key;
}
