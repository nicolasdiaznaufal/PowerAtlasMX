# PowerAtlasMx v2: what the page shows and how it is computed

*Plain-language report for REPSA readers. No long equations. Figures are produced by the pipeline in `pipeline/`; the web page only reads and plots them.*

## 1. What the page answers

**How much is a solar plant's electricity worth at a given place in Mexico, and why does it differ from the average price?**

Solar plants produce at midday, when prices tend to be lowest. So the price a plant actually earns (the *captured price*) is usually below the all-hours average price. The ratio of the two is the **value factor (VF)**: VF = captured price / average price. A VF of 0.80 means the plant earns 20% less than a flat-output generator would.

The page lets the reader pick a node (or a state, a control region, or the whole country), see the price structure, the VF over time, the revenue of 1 MWp of solar, and, with the reader's own cost assumptions, whether that revenue covers the cost of energy (LCOE).

## 2. Data used

| Item | Source and scope |
|---|---|
| Prices | CENACE day-ahead market (MDA) hourly local marginal price (PML) and its three components: system energy, congestion, losses. Jan 2020 to 30 Sep 2026. MDA reference price only: no capacity, clean-energy certificates (CEL) or contracts. |
| Nodes | 2,431 nodes of the national interconnected system (SIN) in the KPI universe. Baja California systems are converted to the common clock but are not in the KPI universe. |
| Clock | Mexico City time (CDMX), fixed UTC-6 all year, no daylight saving, hour-beginning (14:00 is the hour 14:00 to 15:00). |
| Solar resource | NASA POWER hourly irradiance and weather (MERRA-2 / CERES SYN1deg), 170 grid cells covering the nodes, 2015 to 30 Jul 2026. |
| Plant model | pvlib-python (see section 4). |
| Inflation | INPC, used for "today's pesos" (base Sep 2026). Nominal MXN is the default view. |
| Windows | Two 12-month windows: Aug 2025 to Jul 2026 (last 12 months) and Aug 2024 to Jul 2025 (previous 12 months), plus the full history for monthly and daily series. |

Nodes with less than a full year of hourly prices in a window are flagged and never annualised.

## 3. What each part of the page shows and how it is calculated

**Place picker and scope.** A node is one grid point. A state, a region or the nation is the *mean over its member nodes* of the price quantities. The value factor of an area is the ratio of its mean captured price to its mean average price (a ratio of averages, not an average of ratios).

**Left column KPIs.**
- *Average price*: mean PML over all hours of the window.
- *Captured price*: PML averaged with solar production as weight, i.e. what 1 MWp earns per MWh it produces.
- *Value factor*: captured / average, with the "average day" variant computed on the typical day.
- *Solar output at price <= 0*: share of solar energy produced in hours with zero or negative price.
- *Evening peak minus solar hours*: mean price of the highest-priced evening hours minus the mean price in solar hours.

**What the price is made of, hour by hour.** For each hour of the CDMX day, the average PML over the window is split into system energy, losses and congestion (bars), with the PML line, the all-hours average (dashed) and the captured price (dotted). The yellow line is the plant's average output per hour for 1 MWp. Shaded hours are the hours the plant produces at least 5% of its peak hour.

**What-if box.** Three sliders reshape that typical day: a price shift (MXN/MWh), a midday dip (scales how far solar-hour prices fall below the day's level) and a solar yield change. The scenario's captured price, VF and revenue are the published value multiplied by the ratio of the scenario's typical day to the baseline typical day. With neutral sliders the result equals the published figure exactly. Where a scenario pushes the price to zero or below, the value factor is shown as not available.

**PML, congestion and losses, 7-day moving average.** For each day, the mean of the hourly values; each point is then the mean of the trailing 7 days. Price-like fields are weighted by the number of valid hours. The spread plot uses, per day, highest minus lowest hourly PML (days with fewer than 12 hours are left out), then the same 7-day average.

**Value factor by month.** For each month, captured price / average price of that month. Monthly lines are shown for the selected span; the summary is the mean of the monthly values.

**Maps.** One map coloured by the chosen metric (value factor, captured price, % of nodes covering the LCOE, or evening-peak minus solar-hour spread), by region or by state, with the node dots on the same scale. Hovering shows the value. The "% of nodes covering the LCOE" depends on the reader's assumptions.

**Irradiance.** Global horizontal irradiance (GHI, the sunlight on a flat horizontal surface) and plane-of-array irradiance (POA, the sunlight on the tilted or tracking panel), with the clear-sky reference to show cloud loss.

**Revenue.**
- *Revenue per MWp* = yield (MWh produced per MWp) x captured price. In kWh/kWp terms, yield is the plant's "hours at full power".
- *Daily plots*: captured price as a 7-day ratio (revenue of 7 days / energy of the same 7 days), with the span average and the national and regional averages as reference lines; solar hours (hours of the day in which the plant produces) and solar output (MWh per MWp per day), both 7-day averages.
- *Plant economics*: with the reader's inputs (plant size, capex, O&M, discount rate, inflation, plant life, degradation, exchange rate) the page computes the levelised cost of energy (LCOE) and compares it with the captured price to give margin, coverage and break-even. REPSA's own assumptions are pending, so nothing is shown as a verdict until the reader enters a complete set, and it is labelled "under your assumptions".

**Solar configuration choices.** Single-axis tracker or fixed tilt; weather fixed to the 2015 to 2025 yearly mean. The 2015 year is about 6% below the mean of the other years and is kept in the mean and labelled.

## 4. pvlib and NASA POWER

**NASA POWER** is a public service of NASA that provides hourly surface solar radiation and weather on a global grid, derived from satellite and reanalysis products (MERRA-2 and CERES SYN1deg). For each of the 170 cells that cover the nodes, the project uses hourly global horizontal irradiance, air temperature and wind. The same hourly series is used for every node in a cell, so two nearby nodes see the same sky and differ only in price and in latitude-dependent geometry. NASA data end on 30 Jul 2026, so solar lines stop there while price lines continue to 30 Sep 2026. NASA values are model estimates, not station measurements.

**pvlib** (pvlib-python) is the open-source reference library for photovoltaic modelling. The pipeline uses it to turn hourly irradiance into 1 MWp of AC output: it computes the Sun's position for each node and hour, splits horizontal irradiance into direct and diffuse parts, projects them onto the panel (a single-axis tracker, or a fixed tilt equal to 0.76 x |latitude| + 3.1 degrees), estimates cell temperature from air temperature and wind, applies temperature, wiring and inverter losses (DC/AC ratio 1.0, overall derate 0.904, marked as an estimate), and returns AC power per hour. The result is the hourly production profile used everywhere on the page. The same code runs for the clear-sky reference, using NASA's clear-sky radiation, which gives the cloud-loss comparison.

## 5. Reading the numbers: what to keep in mind

- Prices are MDA reference prices. Real contracts, capacity and certificates are not included.
- Production is a model result for an ideal plant, not metered output. The plant parameters are estimates.
- Area figures (state, region, nation) are node averages, not generation-weighted.
- Daily plots show 7-day averages and are smoother than raw hourly data. Very low-price weeks can make the daily VF unstable, so those weeks are left out of the VF display.
- Typical day, revenue and economics exist per 12-month window. With another span the page uses the window that contains the end of the span and says so.
- All numbers on the page are read from files produced by the pipeline and reconcile with the published tables (tests in `tests/` and `web/tests/`).

*Credits: Solar resource: NASA POWER (MERRA-2 / CERES SYN1deg); PV model: pvlib-python. See `docs/CREDITS.md`.*
