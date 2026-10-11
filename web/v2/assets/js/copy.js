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
  fixedTip: 'Panels fixed facing south, tilted at an angle set from the node\'s latitude (about three quarters of the latitude plus 3 degrees); same losses as the tracker.',
  mountNote: 'Single-axis tracker: panels follow the sun east to west with backtracking. Fixed tilt: panels face south at a fixed angle set from the node\'s latitude (about three quarters of the latitude plus 3 degrees). Same losses for both.',
  weatherNote: 'Weather year: the typical day of each month is built from the selected weather and applied to the real prices of the window. Yearly mean is the published default.',
  wxLabel: (v) => (v === 'mean' ? 'Yearly mean (2015–2025)' : v === 'win' ? 'Window weather' : `${v.slice(1)} weather`),
  monthlyNote: 'Monthly series, span summary and calendar-year value factor are for the single-axis tracker with yearly-mean weather (the published monthly series); they do not change with the mounting or weather selection.',
  irrNote: 'Irradiance is available for nodes only. Clear sky is a reference line, not a revenue scenario: KPIs are not computed for it.',
  credits: 'Solar resource: NASA POWER (MERRA-2 / CERES SYN1deg); PV model: pvlib-python.',
};
