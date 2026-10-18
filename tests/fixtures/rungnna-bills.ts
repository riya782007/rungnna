/* Ground truth transcribed by hand from the six photographed bills sent for Rangana (Oct 2026), to check that
   what the purchase-bill reader returns adds up. Each line is [description, qty, rate, printed amount]. */
export type BillLine = [string, number, number, number];
export type Bill = { id: string; supplier: string; date: string; lines: BillLine[]; goods: number; extras?: { label: string; amount: number }[]; grand: number };

const challan5494: BillLine[] = [
  ["CHOTI", 23, 273, 6279], ["CHOTI", 5, 176, 880], ["CHOTI", 5, 190, 950], ["CHOTI", 11, 149, 1639], ["CHOTI", 11, 196, 2156], ["CHOTI", 11, 216, 2376], ["CHOTI", 18, 162, 2916],
  ["SETS", 33, 255, 8415], ["SETS bestly", 40, 86, 3440], ["SETS", 17, 90, 1530], ["SETS", 12, 121, 1452], ["SETS", 16, 193, 3088], ["SETS", 20, 91, 1820], ["SETS", 16, 100, 1600],
  ["SETS", 18, 83, 1494], ["SETS", 17, 95, 1615], ["SETS", 16, 92, 1472], ["SETS", 8, 91, 728], ["SETS", 6, 125, 750], ["SETS", 144, 76, 10944],
  ["Copper Set", 2, 980, 1960], ["Copper Set", 1, 700, 700], ["Copper Set", 1, 685, 685], ["Copper Set", 1, 680, 680], ["Copper Set", 9, 405, 3645], ["Copper Set", 2, 645, 1290],
  ["Copper Set", 2, 590, 1180], ["Copper Set", 2, 405, 810], ["Copper Set", 2, 675, 1350], ["Copper Set", 2, 905, 1810],
  ["Copper Set", 1, 685, 685], ["Copper Set", 5, 380, 1900], ["Copper Set", 2, 1080, 2160], ["Copper Set", 2, 470, 940], ["Copper Set", 2, 770, 1540], ["Copper Set", 1, 895, 895],
  ["Copper Set", 2, 450, 900], ["Copper Set", 4, 690, 2760], ["Copper Set", 3, 550, 1650], ["Copper Set", 3, 550, 1650], ["Copper Set", 1, 500, 500], ["Copper Set", 2, 165, 330], ["Copper Set", 2, 970, 1940],
  ["SETS", 11, 900, 9900], ["SETS", 2, 770, 1540],
  ["mala", 6, 135, 810], ["mala", 6, 960, 5760], ["mala", 6, 180, 1080], ["mala", 6, 180, 1080], ["mala", 6, 176, 1056], ["mala", 6, 230, 1380], ["mala", 6, 285, 1710], ["mala", 7, 170, 1190],
  ["mala", 6, 230, 1380], ["mala", 6, 290, 1740], ["mala", 6, 176, 1056], ["mala", 6, 265, 1590], ["mala", 4, 176, 704], ["mala", 2, 795, 1590], ["mala", 4, 165, 660],
  ["mala", 3, 410, 1230], ["Earrings", 96, 36, 3456],
];

export const BILLS: Bill[] = [
  { id: "order-6-10-2026 (M. Kumar, handwritten)", supplier: "M. Kumar", date: "2026-10-06", goods: 24939, grand: 24939, lines: [
    ["B.N. Kada Mix", 23, 252, 5796], ["Kumar Belt AN Mix", 24, 75, 1800], ["Kumar Belt AN Mix 1", 18, 25, 450], ["Kumar Belt AN Mix 3-2", 36, 35, 1260], ["Kumar Belt AN Mix 4", 18, 58, 1044],
    ["Kumar Belt 0705", 12, 112, 1344], ["Kumar Belt 0714", 12, 100, 1200], ["Kadi Stone 28", 48, 36, 1728], ["Kadi Stone 24", 72, 30, 2160], ["Owlder Belt 9098", 9, 89, 801],
    ["Owlder Belt 9325", 12, 68, 816], ["Gold 0713/0717", 24, 100, 2400], ["Gold R.74", 12, 121, 1452], ["Gold 0704/0708", 24, 112, 2688] ] },
  { id: "challan-5494", supplier: "(challan to Rungnna, 11/02/26)", date: "2026-02-11", goods: 126416, lines: challan5494,
    extras: [{ label: "Discount 5%", amount: -6320.8 }, { label: "PKG", amount: 488 }, { label: "GST", amount: 1417 }], grand: 122000.2 },
  { id: "sale-3801 (pendants)", supplier: "RLJ", date: "2026-09-26", goods: 19584, grand: 19584, lines: [
    ["PENDANT SET", 108, 99, 10692], ["PENDANT SET", 60, 66, 3960], ["PENDANT SET", 24, 108, 2592], ["PENDANT SET", 12, 90, 1080], ["PENDANT SET", 12, 105, 1260] ] },
  { id: "bill-4920 (scrunchies)", supplier: "(scrunchies vendor)", date: "2026-07-22", goods: 21600, extras: [{ label: "CTN-1", amount: 250 }], grand: 21850, lines: [["SCRUNCHIES 30PC (60 BX)", 60, 360, 21600]] },
  { id: "bill-1227 (set + tika)", supplier: "(set/tika vendor)", date: "2026-08-18", goods: 3864, extras: [{ label: "1 Parcel", amount: 256 }], grand: 4120, lines: [
    ["SET 6330", 24, 145, 3480], ["TIKA T.1", 12, 14, 168], ["TIKA T.4", 12, 18, 216] ] },
];
// Page subtotals printed on challan 5494 (lines 1-30, 31-60, 61-62)
export const CHALLAN_PAGES = [69654, 52076, 4686];
