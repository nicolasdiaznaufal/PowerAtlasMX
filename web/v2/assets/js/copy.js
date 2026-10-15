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
    intro: 'Revenue turns the same prices into money: what 1 MWp of solar earns in a year by selling each hour at that hour\'s price. '
      + 'The hour-by-hour bars follow the typical day and are scaled to the published yearly figure. '
      + 'The window is the 12 months shown in the controls; this is the MDA reference price, with no capacity, CEL or contracts.',
  },
  decomp: {
    title: 'What the price is made of, hour by hour',
    note: 'System energy is the price minus losses and congestion. Shaded hours are the hours the plant produces (at least 5% of its peak hour). '
      + 'The yellow line is solar output (right axis); the dashed lines are the all-hours average price and the price solar captures.',
  },
  scopeNote: 'Switch the level of the analysis: the node you picked, its state, its region, or the whole country.',
  seriesNote: 'Every place carries the monthly value factor. Monthly average and captured prices are drawn for the nodes with a published sheet; calendar years carry them for every place.',
  fixedTip: 'Panels fixed facing south, tilted at an angle set from the node\'s latitude (about three quarters of the latitude plus 3 degrees); same losses as the tracker.',
  mountNote: 'Single-axis tracker: panels follow the sun east to west with backtracking. Fixed tilt: panels face south at a fixed angle set from the node\'s latitude (about three quarters of the latitude plus 3 degrees). Same losses for both.',
  weatherNote: 'Weather year: the typical day of each month is built from the selected weather and applied to the real prices of the window. Yearly mean is the published default.',
  wxLabel: (v) => (v === 'mean' ? 'Yearly mean (2015–2025)' : v === 'win' ? 'Window weather' : `${v.slice(1)} weather`),
  monthlyNote: 'Monthly series, span summary and calendar-year value factor are for the single-axis tracker with yearly-mean weather (the published monthly series); they do not change with the mounting or weather selection.',
  ghiNote: 'Global horizontal irradiance (GHI) is the total sunlight reaching a flat, horizontal surface: the direct beam from the sun plus the diffuse light from the sky. It is counted as energy per area, in kWh/m² per month or per year.',
  poaNote: 'Plane of array (POA) is the same sunlight measured on the panel\'s own surface, tilted or tracking the sun, which is what the plant actually receives.',
  clockNote: 'Hours are Mexico City time (CDMX), hour beginning: fixed UTC−6 all year, no daylight saving. 14:00 is the hour from 14:00 to 15:00. Baja California and Baja California Sur are converted to this common clock.',
  irrNote: 'Irradiance is available for nodes only. Clear sky is a reference line, not a revenue scenario: KPIs are not computed for it.',
  daily: {
    avg: 'A 7-day moving average takes each day together with the 6 days before it and averages them, which smooths the day-to-day noise; a day is drawn only when at least 4 of its 7 days have data.',
    parts: 'PML is the price at the node; congestion and losses are the parts of it that come from grid congestion and from energy lost on the way. The three are drawn on one plot as 7-day moving averages.',
    spread: 'Price spread is the highest minus the lowest hourly price of the day; days with fewer than 12 hours of prices are left out.',
    revenue: 'Revenue is what 1 MWp earns each day by selling every sunlit hour at that hour\'s price, averaged over 7 days.',
    cap: 'Captured price is the revenue of the 7 days divided by the energy of the same 7 days: the average price solar actually earned.',
    hours: 'Solar hours are the hours of the day in which the plant produces, averaged over 7 days.',
    output: 'Solar output is the energy 1 MWp produces per day, averaged over 7 days.',
    weather: 'Daily values use the actual daily NASA POWER weather (not the yearly mean); the weather-year selector and the scenario sliders do not apply to these daily charts (nothing here is simulated).',
    end: 'Solar fields end on 2026-07-30 (NASA POWER data limit): solar lines stop there, price-only lines continue to 2026-09-30.',
    scope: 'MDA reference price (CENACE); no capacity, CEL or contracts. Fixed tilt or tracker follows the mounting you picked.',
    lazy: 'Daily values load when this section comes into view.',
  },
  credits: 'Solar resource: NASA POWER (MERRA-2 / CERES SYN1deg); PV model: pvlib-python.',
};
