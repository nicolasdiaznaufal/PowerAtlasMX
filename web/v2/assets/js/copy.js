// Editable copy for the analysis pages (DRAFT, pending Nico's approval). Plain English, no equations.
export const COPY = {
  explorer: {
    title: 'Explorer',
    intro: 'Explorer shows how solar output lines up with the price of power for the place you picked. It splits the typical-day price into its parts, '
      + 'compares the price solar actually earns (captured price) with the all-hours average price, and tracks that ratio, the value factor, month by month. '
      + 'The window is the 12 months shown in the controls; prices are the MDA reference price from CENACE.',
  },
  revenue: {
    title: 'Revenue',
    intro: 'Revenue turns the same prices into money: what 1 MWp of solar earns in a year by selling each hour at that hour\'s price, '
      + 'and how much a flat average price would overstate it. The hour-by-hour bars follow the typical day and are scaled to the published yearly figure. '
      + 'The window is the 12 months shown in the controls; this is the MDA reference price, with no capacity, CEL or contracts.',
  },
  decomp: {
    title: 'What the price is made of, hour by hour',
    note: 'System energy is the price minus losses and congestion. Shaded hours are the hours the plant produces (at least 5% of its peak hour). '
      + 'The yellow line is solar output (right axis); the dashed lines are the all-hours average price and the price solar captures.',
  },
  scopeNote: 'Switch the level of the analysis: the node you picked, its state, its region, or the whole country.',
  seriesNote: 'Monthly prices are not published, only the monthly value factor. Calendar years also carry the average and captured price.',
  fixedTip: 'Not in the analysis yet',
};
