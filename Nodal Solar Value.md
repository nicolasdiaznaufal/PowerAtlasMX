**REPSA** · Origination analyticsOctober 2026

Nodal solar value · CENACE MDA · SIN

# What is a solar MWh worth at each node?

We value a **1 MWp photovoltaic plant at every node of the national grid** by multiplying its hour-by-hour production by the hour-by-hour nodal price. Then we compare that with the average-price shortcut used today in office prospection, and ask which nodes cover their cost.

What we analyze

- **Prices.** CENACE day-ahead nodal prices (PML), 2,449 nodes with data, every hour.
- **Two years.** Aug 2024 – Jul 2025 and Aug 2025 – Jul 2026; solar results on Aug–Jun of each, because NASA weather ends 30 Jun 2026.
- **Production.** pvlib model of a single-axis tracker at each node, with NASA POWER weather.
- **Output.** Captured price, value factor, revenue and margin by node, state and region.

REPSA Group

*01*\
Notation*02*\
Prices*03*\
Revenue*04*\
Value factor*05*\
Profitability*06*\
Node P&L*07*\
Conclusions*A*\
Appendix: sun to kWh, shortcut

**01** · NotationNodal solar value

Read this once

## Every symbol in this deck

Four families: what the market pays, what the plant produces, how the panel behaves, and what it costs. Each later slide repeats the symbols it uses.

Price

**\\(h\\)** hour of the day, 0–23, hour in which the interval starts. CENACE publishes 1–24 (hour ending), so \\(h=\\text{hora}-1\\).

**\\(\\mathrm{PML}\_h\\)** day-ahead nodal price in hour \\(h\\), MXN/MWh = energy \\(\\lambda^E\\) + losses \\(\\lambda^L\\) + congestion \\(\\lambda^C\\)

**\\(N\\)** number of hours in the period (8,760 in a year)

**\\(\\overline{\\mathrm{PML}}\\)** simple average of all \\(N\\) hourly prices

**\\(P\_{\\mathrm{cap}}\\)** captured price: production-weighted average price

**\\(\\mathrm{VF}\\)** value factor, \\(P\_{\\mathrm{cap}}/\\overline{\\mathrm{PML}}\\), no unit

Production

**\\(P\_{\\mathrm{STC}}\\)** nameplate DC power of the panels at standard test conditions, kWp or MWp

**\\(E_h\\)** AC energy delivered in hour \\(h\\), MWh

**\\(y_h\\)** energy per installed kWp in hour \\(h\\), kWh/kWp (= MWh/MWp)

**\\(Y_f\\)** annual yield \\(\\sum_h y_h\\), kWh/kWp

**\\(\\mathrm{GHI}\\)** sunlight on a horizontal surface, W/m²

**\\(G\_{\\mathrm{POA}}\\)** sunlight on the tilted panel surface (plane of array), W/m²

Panel physics

**\\(G\_{\\mathrm{STC}},T\_{\\mathrm{STC}}\\)** test reference: 1,000 W/m² and 25 °C cell temperature

**\\(T_a,\\ T_c,\\ v\\)** air temperature, cell temperature (°C), wind speed (m/s)

**\\(\\gamma\\)** power temperature coefficient of the panel, %/°C, negative

**\\(L\_{\\mathrm{sys}},\\ \\eta\_{\\mathrm{inv}}\\)** system losses (wiring, soiling, mismatch); inverter efficiency

**\\(r\\)** DC/AC ratio: panel kWp per kW of inverter

**\\(\\mathrm{PR}\\)** performance ratio: share of plane-of-array sunlight that leaves the plant as AC energy

Economics

**\\(R\\)** revenue from selling energy at the node, MXN

**\\(R\_{\\mathrm{short}}\\)** revenue as if every MWh sold at \\(\\overline{\\mathrm{PML}}\\) (REPSA's average-price shortcut)

**\\(H\_{\\mathrm{GHI}}\\)** annual horizontal irradiation, kWh/m²

**\\(\\mathrm{LCOE}\\)** levelized cost of energy, USD/MWh (or MXN/MWh)

**\\(\\mathrm{VF}\_{\\mathrm{req}}\\)** value factor needed to break even

**\\(\\Pi\\)** annual margin: revenue minus levelized cost, MXN

Units: prices in MXN/MWh as published by CENACE. USD figures use 17.84 MXN/USD (Banxico FIX, 28 Sep 2026). “Module” and “panel” mean the same thing: one photovoltaic panel.

**02** · PricesSimple average vs captured price

Two averages of the same prices

## A plant earns the captured price, not the average

Both average the same hourly prices. Only the weights differ: equal for every hour, or proportional to what the plant produces.

What a PML is · precio marginal local\\\[ \\mathrm{PML}\_{n,h}=\\underbrace{\\lambda^{E}\_{h}}\_{\\text{system energy}}+\\underbrace{\\lambda^{L}\_{n,h}}\_{\\text{losses}}+\\underbrace{\\lambda^{C}\_{n,h}}\_{\\text{congestion}} \\\]

Cost of serving one more MWh at node \\(n\\) in hour \\(h\\). **System energy**: cheapest generator if the grid had no limits; it changes every hour but is one value for the whole SIN (identical at all nodes in all 8,760 h of Aug 25 – Jul 26; mean 586, range 0–3,643 MXN/MWh). **Losses** and **congestion** differ by node: congestion averaged +836 MXN/MWh in Peninsular (cheap power cannot get in) and −217 in Noroeste (too much local supply to export).

Simple average · every hour weighs 1/N\\\[ \\overline{\\mathrm{PML}}=\\frac{1}{N}\\sum\_{h=1}^{N}\\mathrm{PML}\_h \\\]

Captured price · every hour weighs by production\\\[ P\_{\\mathrm{cap}}=\\sum\_{h=1}^{N} w_h\\,\\mathrm{PML}\_h,\\qquad w_h=\\frac{y_h}{\\sum\_{k=1}^{N} y_k},\\qquad \\sum_h w_h = 1 \\\]

Night hours count in \\(\\overline{\\mathrm{PML}}\\) but have \\(w_h=0\\) in \\(P\_{\\mathrm{cap}}\\). If production and price were unrelated, both would be equal: \\(P\_{\\mathrm{cap}}-\\overline{\\mathrm{PML}}=N\\,\\mathrm{Cov}(w,\\mathrm{PML})\\). In Mexico prices fall at midday, exactly when \\(w_h\\) is largest, so *\\(P\_{\\mathrm{cap}}\<\\overline{\\mathrm{PML}}\\)*.

Midday price dip, MXN/MWh

Evening peak, MXN/MWh

Mounting

Average · MXN/MWh

Captured · MXN/MWh

VF · no unit

Energy at PML ≤ 0 · %

PML by hourSimple average \\(\\overline{\\mathrm{PML}}\\)Captured price \\(P\_{\\mathrm{cap}}\\)

Production \\(y_h\\)

**\\(h\\)** hour of day, 0–23 (interval start)**\\(N\\)** number of hours in the period**\\(\\mathrm{PML}\_h\\)** nodal price in hour \\(h\\), MXN/MWh**\\(y_h\\)** energy produced in hour \\(h\\) per kWp, kWh/kWp**\\(w_h\\)** share of the period's energy produced in \\(h\\)**Sliders** synthetic day, base price 600 MXN/MWh**\\(n\\)** price node**\\(\\lambda^{E},\\lambda^{L},\\lambda^{C}\\)** energy, losses and congestion components, MXN/MWh**Where \\(y_h\\) comes from.** Here: an illustrative bell curve, peak normalized to about 1 kWh/kWp. In the node analysis (next slides): pvlib \[1\] single-axis tracker at each node with NASA POWER hourly irradiance and temperature \[3\]; see appendix A1–A3.

**02** · Prices · any node, state or region2,449 nodes · real CENACE prices

Explorer

## Pick a node, a state or a region and compute its value factor

Charts show the average day; the exact VF uses every hour, and the gap between the two is the seasonal effect.

Avg price · MXN/MWh

Captured · MXN/MWh

VF exact · no unit

VF average day

Spread peak−solar · MXN/MWh

PV energy at PML ≤ 0 · %

System energy \\(\\lambda^E\\)Losses \\(\\lambda^L\\)Congestion \\(\\lambda^C\\)PML\\(\\overline{\\mathrm{PML}}\\)\\(P\_{\\mathrm{cap}}\\)hover a bar for its composition

Production \\(y_h\\), average day

VF by monthVF of the period

**\\(\\lambda^E,\\lambda^L,\\lambda^C\\)** system energy, losses, congestion, MXN/MWh (average by hour)**\\(y_h\\)** pvlib single-axis tracker, kWh/kWp**Spread** mean PML 18–22 h minus mean PML 06–18 h**Data.** NASA weather ends 30 Jun 2026, so the KPIs of both years use Aug–Jun days; the hourly price chart uses all days with prices and the monthly VF all days with NASA data (no July in 2025–26). State and region values are averages over their nodes (Cozumel and nodes with fewer than 300 days excluded); their VF is the ratio of averages. Clear sky (Ineichen–Perez, no clouds) is shown for reference. VF average day \\(=\\sum_h \\bar y_h\\,\\overline{\\mathrm{PML}}\_h/(\\overline{\\mathrm{PML}}\\sum_h\\bar y_h)\\).

**03** · RevenueAny node, state or region · real CENACE prices

Production × price, hour by hour

## What the value factor costs a plant

Revenue is energy times the captured price. REPSA's shortcut prices that energy at the simple average, i.e. it assumes VF = 1, and so overstates revenue by 1/VF − 1.

Revenue of a plant at one node\\\[ R=\\sum_h E_h\\,\\mathrm{PML}\_h=P\_{\\mathrm{STC}}\\sum_h y_h\\,\\mathrm{PML}\_h = P\_{\\mathrm{STC}}\\,Y_f\\,P\_{\\mathrm{cap}} \\\]

REPSA's average-price shortcut\\\[ R\_{\\mathrm{short}}=P\_{\\mathrm{STC}}\\,Y_f\\,\\overline{\\mathrm{PML}} \\\]

Value factor\\\[ \\mathrm{VF}=\\frac{P\_{\\mathrm{cap}}}{\\overline{\\mathrm{PML}}}=\\frac{R}{R\_{\\mathrm{short}}}\\qquad \\frac{R\_{\\mathrm{short}}}{R}-1=\\frac{1}{\\mathrm{VF}}-1 \\\]

How to read the revenue chart

Two bars per hour: what 1 MWp earns in that hour of an average day. **Grey**: the shortcut (energy × average price). **Orange**: what the node pays (energy × that hour's price). Orange shorter means the plant sells below the average price; summed over the day, the gap is the revenue the shortcut overstates.

Avg price · MXN/MWh

Captured · MXN/MWh

VF

Real R · M MXN

Shortcut · M MXN

Overstated · %

System energy \\(\\lambda^E\\)Losses \\(\\lambda^L\\)Congestion \\(\\lambda^C\\)PML\\(\\overline{\\mathrm{PML}}\\)\\(P\_{\\mathrm{cap}}\\)

Shortcut revenue \\(y_h\\,\\overline{\\mathrm{PML}}\\)Real revenue \\(y_h\\,\\mathrm{PML}\_h\\)1 MWp · average day · MXN

\\(Y_f\\) used, kWh/kWp·yr: model × (1 − 14 % losses), drag to override

**\\(P\_{\\mathrm{STC}}\\)** nameplate DC power, MWp (here 1 MWp)**\\(E_h=P\_{\\mathrm{STC}}\\,y_h\\)** energy in hour \\(h\\), MWh**\\(Y_f=\\sum_h y_h\\)** annual yield, kWh/kWp = MWh/MWp**\\(\\mathrm{PML}\_h,\\ \\overline{\\mathrm{PML}}\\)** hourly price; its simple average, MXN/MWh**\\(P\_{\\mathrm{cap}}\\)** production-weighted price, MXN/MWh**\\(R,\\ R\_{\\mathrm{short}}\\)** real and shortcut revenue, M MXN per MWp per year**Shortcut.** REPSA's initial office-prospection approach (“Total Generation”) values every MWh at the simple average price, i.e. it implicitly sets VF = 1 (decomposed in appendix A5). **Data.** CENACE MDA prices; \\(y_h\\) from pvlib with NASA POWER weather, Aug–Jun days of each year. Revenue KPIs use every hour (exact VF); the bars use the average day, so their daily sums give the average-day VF, which differs by a few hundredths. Pvlib output has no wiring or inverter losses, so \\(Y_f\\) is reduced by 14 % (PVWatts default).

**04** · Value factorHirth (2013)

What VF tells you, and what it doesn't

## A falling VF is the fingerprint of cannibalization

VF below 1 is normal in Mexico because demand peaks after sunset. Its level today matters less than two things: where it is heading, and the price level it multiplies.

Definition · Hirth (2013) \[4\]\\\[ \\mathrm{VF}=\\frac{P\_{\\mathrm{cap}}}{\\overline{\\mathrm{PML}}}=\\frac{\\sum_h y_h\\,\\mathrm{PML}\_h}{\\overline{\\mathrm{PML}}\\,\\sum_h y_h} \\\]

**VF = 1:** the plant's hours are worth as much as the average hour. **VF = 0.80:** it collects 20 % less than the average price suggests.

Why the trend and the price level matter more

**Trend.** Every new solar plant adds energy in the same midday hours and pushes those prices down, so VF falls as solar grows. A plant lives 25–30 years: a VF that falls every year means future revenue below today's. Between 2024–25 and 2025–26 (same Aug–Jun days) VF fell at 97 % of nodes; Peninsular went from 0.95 to 0.65.

**Price level.** Revenue per MWh is \\(P\_{\\mathrm{cap}}=\\mathrm{VF}\\cdot\\overline{\\mathrm{PML}}\\). Solar's VF rarely exceeds 1, so if \\(\\overline{\\mathrm{PML}}\\) itself is below the cost per MWh, no timing can rescue the node. Noroeste: \\(\\overline{\\mathrm{PML}}=260\\) MXN/MWh against an LCOE of 714 (40 USD/MWh) would need VF = 2.75.

Profitability test (slide 08)\\\[ P\_{\\mathrm{cap}}\\ge \\mathrm{LCOE}\\iff \\mathrm{VF}\\ge\\mathrm{VF}\_{\\mathrm{req}}=\\frac{\\mathrm{LCOE}}{\\overline{\\mathrm{PML}}} \\\]

Two different ways solar loses value

|  | Curtailment | Price cannibalization |
| --- | --- | --- |
| Nature | Physical limit on output | Market effect on the price |
| Cause | Grid congestion, missing transmission, low demand | Many PV plants producing in the same hours |
| What happens | Operator orders the plant to reduce output | Plant keeps producing, sells cheap or below zero |
| Loss | MWh not produced | MXN per MWh (lower VF) |
| Remedy | Transmission, storage | Storage, PPA, site diversification |

**Where they meet:** at PML ≤ 0 a merchant plant prefers to curtail itself. Share of PV energy produced at PML ≤ 0 with NASA weather, Aug 2025 – Jun 2026: *Noroeste 5.9 %, Norte 5.8 %*, every other region 0.6–0.8 %.

VF by control region · Aug 2025 – Jun 2026

**\\(P\_{\\mathrm{cap}}\\)** production-weighted price, MXN/MWh**\\(\\overline{\\mathrm{PML}}\\)** simple 24-hour average price, MXN/MWh**\\(y_h,\\ \\mathrm{PML}\_h\\)** hourly production per kWp; hourly price**\\(\\mathrm{LCOE}\\)** levelized cost of energy, MXN/MWh**\\(\\mathrm{VF}\_{\\mathrm{req}}\\)** VF needed to break even**Regions** node averages; VF = ratio of averages\[4\] Hirth, L. (2013). The market value of variable renewables. *Energy Economics* 38, 218–236. Some studies divide by a load-weighted average; we use the time average (baseload).

04 · Value factor · map

## Value factor by control region

Δ = value in 2025–26 minus value in 2024–25, same Aug–Jun days. Negative: it fell.

Metric

LCOE, USD/MWh

Node on the map (type a code, substation, municipality or state)

Hover or click a region or state to fill the left card; pick a node to place it on the map (orange marker) and compare it with its state and region on the right. Values: NASA weather, Aug–Jun days of each year; areas are node averages, VF is the ratio of averages. States are colored by their own nodes in “States” mode. Baja California systems are not in the SIN dataset; Cozumel excluded.

**05** · ProfitabilityMerchant plant · energy revenue only

The break-even test

## Does a merchant plant pay for itself?

A plant pays for itself when every MWh it sells earns more than it costs to produce. That cost per MWh is the LCOE.

LCOE in words

The **levelized cost of energy** is the constant price per MWh at which a plant, over its whole life, recovers its investment, its operating costs and the return its investors require.

**Why it matters.** It turns all project costs into the market's unit, MXN/MWh, so it can be compared directly with the captured price. It is the hurdle every MWh must clear: above it the plant creates value, below it the plant destroys value however much it produces.

LCOE, formally\\\[ \\mathrm{LCOE}=\\frac{\\sum\_{t=0}^{T}(\\mathrm{CAPEX}\_t+\\mathrm{O\\&M}\_t)\\,(1+i)^{-t}}{\\sum\_{t=1}^{T}E_t\\,(1+i)^{-t}} \\\]

Break-even condition\\\[ P\_{\\mathrm{cap}}\\ge\\mathrm{LCOE}\\iff\\mathrm{VF}\\ge\\mathrm{VF}\_{\\mathrm{req}}=\\frac{\\mathrm{LCOE}}{\\overline{\\mathrm{PML}}} \\\]

LCOE, USD/MWh

Year (Aug–Jun days)

Captured · MXN/MWh

LCOE · MXN/MWh

Margin · MXN/MWh

VF / VF req

Break-even · USD/MWh

\\(P\_{\\mathrm{cap}}\\ge\\) LCOE\\(P\_{\\mathrm{cap}}\<\\) LCOELCOE

**\\(P\_{\\mathrm{cap}},\\ \\overline{\\mathrm{PML}}\\)** captured and average price, MXN/MWh**\\(\\mathrm{VF}\_{\\mathrm{req}}\\)** VF needed to break even**\\(\\mathrm{CAPEX}\_t,\\ \\mathrm{O\\&M}\_t\\)** investment and operating cost in year \\(t\\), MXN**\\(E_t\\)** energy sold in year \\(t\\), MWh**\\(i,\\ T\\)** discount rate (cost of capital); plant life in years**FX** 17.84 MXN/USDPublished LCOE for utility PV in Mexico ranges from ≈ 20–35 USD/MWh (IRENA summary) to ≈ 40–50 incl. a 5–10 USD regulatory risk premium (SurgePV); IEA 2021: 51. Use REPSA's own project LCOE. Energy revenue only: capacity market, CELs, ancillary services, PPAs and storage are excluded. Area values are node averages.

**06** · Node P&LOne plant · one place · one year

Revenue, cost and margin

## One plant at one node: does it make money?

Margin is energy times the gap between captured price and LCOE. Plant size and yield only scale the result; whether it is a profit or a loss depends on the captured price versus the cost.

Energy and revenue\\\[ E=P\_{\\mathrm{STC}}\\,Y_f,\\qquad R=E\\,P\_{\\mathrm{cap}}=E\\cdot\\mathrm{VF}\\cdot\\overline{\\mathrm{PML}} \\\]

Cost and margin\\\[ C=E\\cdot\\mathrm{LCOE},\\qquad \\Pi=R-C=E\\,\\bigl(P\_{\\mathrm{cap}}-\\mathrm{LCOE}\\bigr) \\\]

LCOE already includes capex, O&M and the investors' return, so \\(\\Pi\\) is the value created above that return, not an accounting profit.

What the numbers say

Average price \\(\\overline{\\mathrm{PML}}\\), MXN/MWh

Value factor VF

Losses not in the model, %

Plant size \\(P\_{\\mathrm{STC}}\\), MWp

LCOE, USD/MWh

LCOE, MXN/MWh

Captured · MXN/MWh

\\(Y_f\\) used · kWh/kWp

Energy · GWh/yr

Revenue · M MXN/yr

Margin · M MXN/yr

**\\(E\\)** annual energy, MWh**\\(P\_{\\mathrm{STC}},\\ Y_f\\)** plant size, MWp; yield, kWh/kWp = MWh/MWp**\\(R,\\ C,\\ \\Pi\\)** revenue, levelized cost, margin, MXN/yr**\\(\\mathrm{VF},\\ \\overline{\\mathrm{PML}}\\)** value factor; average price**\\(P\_{\\mathrm{cap}}\\)** \\(\\mathrm{VF}\\cdot\\overline{\\mathrm{PML}}\\), MXN/MWh**FX** 17.84 MXN/USDChoosing a node, state or region loads its measured \\(\\overline{\\mathrm{PML}}\\), VF and modeled \\(Y_f\\) (pvlib + NASA weather, Aug–Jun days, annualized). The model has no wiring, soiling or inverter losses, so \\(Y_f\\) is reduced by the loss slider (PVWatts default 14 %). Moving the price or VF slider overrides the data. Merchant energy revenue only.

**07** · ConclusionsNASA weather · Aug–Jun of 2024–25 and 2025–26

What the two years tell us

## Average prices overstate solar revenue, and the gap is growing

Five findings from 2,407–2,420 nodes with complete data, and what they mean for origination.

1 · The shortcut

**+26 %**

Pricing solar energy at the average price overstates revenue by 26 % nationally in 2025–26 (VF 0.79), and by 53–73 % in Peninsular, Norte and Noroeste (VF 0.58–0.65).

2 · The trend

**97 %**

of nodes saw their VF fall from 2024–25 to 2025–26. National VF went from 0.86 to 0.79; Peninsular from 0.95 to 0.65, the largest drop, while its average price stayed above 1,500 MXN/MWh.

3 · Profitability

**33 → 5 %**

Share of nodes whose captured price covers an LCOE of 40 USD/MWh (714 MXN/MWh): 33 % in 2024–25, 5 % in 2025–26. In 2025–26 almost all of them are in Peninsular (98 % of its nodes).

4 · Price level

**150**

MXN/MWh: Noroeste's captured price in 2025–26 (Norte: 213). Both are below even a 20 USD/MWh LCOE (357 MXN/MWh). There the problem is the price level, not the timing of production.

5 · Node choice

**0 of 20**

In Oriental, the top 20 nodes by shortcut revenue and by real revenue share no node (2025–26). Nationally the ranking barely changes (Spearman 0.98): the shortcut finds the region, not the node.

VF 2024–25VF 2025–26same Aug–Jun days, node averages

What to do next

**Screen with captured price.** Replace the average price with \\(P\_{\\mathrm{cap}}\\) per node (explorer, slide 04) in office prospection.

**Model the trend.** Project VF downward over the plant life, not flat at today's value.

**Add storage and contracts.** Value BESS shifting to the 18–22 h peak, and PPAs where VF is low.

**Tighten the yield.** Full pvlib ModelChain with losses and inverter, P50/P90, and July 2026 once NASA publishes it.

All figures: NASA POWER weather, pvlib single-axis tracker, CENACE MDA prices, Aug–Jun days of each year; nodes with at least 300 complete days, Cozumel excluded. Share of nodes covering LCOE: 795 of 2,407 (2024–25) and 127 of 2,420 (2025–26). Ranking test: shortcut revenue \\(Y_f\\cdot\\overline{\\mathrm{PML}}\\) vs real revenue \\(Y_f\\cdot P\_{\\mathrm{cap}}\\).

**REPSA** · Assumptions and sourcesNodal solar value

What the numbers rest on

## Assumptions and sources

Data and conventions

- Prices: CENACE MDA PML, SIN, Dec 2023 – Jul 2026. Windows: Aug 2024 – Jul 2025 and Aug 2025 – Jul 2026; complete days only.
- Hours: CENACE hour-ending 1–24 shifted to hour-beginning 0–23. All SIN nodes appear to publish in central time (UTC−6).
- Production \\(y_h\\): pvlib single-axis tracker (±60°, backtracking, GCR 0.35) with NASA POWER GHI and air temperature. NASA data end 30 Jun 2026, so solar KPIs use Aug–Jun days of each year. Days with any missing NASA hour are excluded, not counted as zero.
- Yield: the model includes a heat derate but no wiring, soiling or inverter losses; revenue and P&L reduce \\(Y_f\\) by 14 % (PVWatts default). VF is almost unaffected by these losses.
- Areas: node averages per state or control region; VF = ratio of averages; Cozumel and nodes with fewer than 300 days excluded.
- FX 17.84 MXN/USD (Banxico FIX, 28 Sep 2026). Slides 03 (synthetic day) and A4 (one hour) use illustrative inputs.

REPSA Group

pvlib

NASA POWERPrediction Of Worldwide Energy Resources · NASA LaRC

References

1. Holmgren, Hansen, Mikofski (2018), pvlib python, *JOSS* 3(29), 884; Anderson et al. (2023), *JOSS* 8(92), 5994. [pvlib-python.readthedocs.io](https://pvlib-python.readthedocs.io/)
2. Ineichen, Perez (2002), Linke turbidity formulation, *Solar Energy* 73(3), 151–157.
3. NASA Langley Research Center POWER Project. [power.larc.nasa.gov](https://power.larc.nasa.gov/docs/services/)
4. Hirth (2013), The market value of variable renewables, *Energy Economics* 38, 218–236.
5. Faiman (2008), *Progress in Photovoltaics* 16(4), 307–315.
6. Dobos (2014), PVWatts Version 5 Manual, NREL/TP-6A20-62641.
7. CENACE, Mercado de Día en Adelanto, precios marginales locales.
8. NSRDB (NREL): [nsrdb.nlr.gov](https://nsrdb.nlr.gov/data-sets/us-data). LCOE ranges: [IEA](https://www.iea.org/reports/cost-of-capital-observatory/tools-and-analysis), [SurgePV](https://www.surgepv.com/blog/solar-lcoe-by-country).
9. REPSA, “6. Origination – Office prospection calculations” (Total Generation formula).

The NASA POWER entry is set in type; it is a data credit, not an endorsement. The appendix (A1–A5) explains how production is modeled and how the shortcut relates to the hourly model.

**A1** · Appendix · From sun to kWhpvlib · NASA POWER

Where \\(y_h\\) comes from

## pvlib models the plant; NASA POWER supplies the weather

We define one plant, place it at every node and let pvlib turn each hour of weather into energy.

pvlib

Open-source Python library for photovoltaic modeling, maintained by Sandia National Laboratories, NREL and contributors \[1\]. Its ModelChain runs the calculation from three inputs: **Location** (where), **PVSystem** (what is built: panels, tracker, inverter) and **Weather** (what happened).

The chain for every hour and every node

**1 · Weather**NASA POWER hourly GHI (W/m²) and air temperature \\(T_a\\) (°C), UTC

→

**2 · Sun position**zenith \\(\\theta_z\\) and azimuth \\(\\varphi_s\\) from date, time and location

→

**3 · Split the light**GHI into direct (DNI) and diffuse (DHI), Erbs model

→

**4 · Tracker angle**single axis N–S, ±60°, backtracking to avoid shading

↓

**8 · Revenue**\\(y_h\\times\\mathrm{PML}\_h\\), summed over the year

←

**7 · Energy per kWp**\\(y_h\\), kWh/kWp, eq. (7)

←

**6 · Heat and power**cell temperature, DC and AC power, eq. (4)–(6)

←

**5 · Light on the panel**\\(G\_{\\mathrm{POA}}\\), W/m², eq. (1)–(3)

NASA POWER run · 1 Oct 2026

Data cover Aug 2024 – Jun 2026 (July 2026 not yet published). Days with any missing hour are excluded, not counted as zero. Compared with clear sky, real weather lowers VF by 0.00–0.06: most in Norte and Noroeste, where cloudy summer afternoons coincide with high prices.

NASA POWER · 1° solar grid over Mexico

Each square is one NASA POWER solar cell, 1° × 1° (about 100 × 110 km); every node inside it receives the same weather series. Fine for screening; for ranking nodes inside a region use NSRDB (2–4 km); for financing, measured or bankable data.

\[1\] Holmgren, W. F., Hansen, C. W., Mikofski, M. A. (2018). pvlib python. *JOSS* 3(29), 884; Anderson, K. S. et al. (2023). *JOSS* 8(92), 5994. \[3\] NASA Langley Research Center POWER Project, power.larc.nasa.gov. Solar parameters 1° × 1°; meteorology 0.5° × 0.625°. Hourly data are in UTC; we shift them to CENACE central time (UTC−6) and centre each value on its hour.

**A2** · Appendix · From sun to kWhChain step 5 · equations (1)–(3)

How much sunlight reaches the panel

## Tilt and tracking decide how much light the panel catches

Weather data give sunlight on flat ground. A panel converts only the light that hits its own surface, so we move the light onto the panel plane.

(1) How head-on the sun hits the panel · pvlib.irradiance.aoi\\\[ \\cos\\theta_i=\\cos\\theta_z\\cos\\beta+\\sin\\theta_z\\sin\\beta\\cos(\\varphi_s-\\varphi_p) \\\]

**In words:** \\(\\theta_i\\) is the angle between the sun's rays and the line perpendicular to the panel. At \\(\\theta_i=0\\) the panel catches the full direct beam; at 60° only half (\\(\\cos 60^\\circ=0.5\\)). A tracker turns the panel every hour to keep \\(\\theta_i\\) small.

(2) Sunlight on the panel, isotropic sky · pvlib.irradiance.get_total_irradiance\\\[ G\_{\\mathrm{POA}}=\\underbrace{\\mathrm{DNI}\\cos\\theta_i}\_{\\text{direct}}+\\underbrace{\\mathrm{DHI}\\,\\tfrac{1+\\cos\\beta}{2}}\_{\\text{sky diffuse}}+\\underbrace{\\rho\\,\\mathrm{GHI}\\,\\tfrac{1-\\cos\\beta}{2}}\_{\\text{ground reflected}} \\\]

**In words:** three sources add up (sketch on the right): the direct beam, scaled by eq. (1); light scattered by the sky, of which a tilted panel sees a fraction; and light reflected by the ground. For a tracker in Mexico, \\(G\_{\\mathrm{POA}}\\) is about 20–30 % above GHI over a year.

(3) Light that actually enters the cell · pvlib.iam\\\[ G\_{\\mathrm{eff}}=\\bigl(\\mathrm{DNI}\\cos\\theta_i\\cdot\\mathrm{IAM}(\\theta_i)+G\_{\\mathrm{diff}}\\bigr)(1-L\_{\\mathrm{soil}}) \\\]

**In words:** glass reflects more light at grazing angles (IAM \< 1) and dust blocks a few percent. Our runs fold this into the 14 % loss allowance.

Angles of eq. (1)

Three sources of eq. (2)

**\\(\\theta_z\\)** solar zenith angle (sun vs vertical)**\\(\\theta_i\\)** angle of incidence (sun vs panel normal)**\\(\\beta,\\ \\varphi_p\\)** panel tilt and the direction it faces**\\(\\varphi_s\\)** solar azimuth**\\(\\mathrm{DNI}\\)** direct normal irradiance, W/m²**\\(\\mathrm{DHI},\\ \\mathrm{GHI}\\)** diffuse and global horizontal irradiance, W/m²**\\(\\rho\\)** ground albedo, ≈ 0.2**\\(\\mathrm{IAM}\\)** incidence-angle modifier, ≤ 1**\\(L\_{\\mathrm{soil}}\\)** soiling loss fractionvalor_nodo.py uses eq. (2) with the isotropic sky and a single-axis tracker (±60°, backtracking, ground coverage ratio 0.35). pvlib's ModelChain default is the Hay–Davies sky model, which adds a circumsolar term.

**A3** · Appendix · From sun to kWhChain steps 6–7 · equations (4)–(7)

From light on the panel to energy at the meter

## Heat, wiring and the inverter take their share

Once we know the light on the panel, four steps give the AC energy. Heat varies most between sites: a panel in Sonora runs hotter than one in Veracruz and loses more power.

(4) Cell temperature · Faiman\\\[ T_c=T_a+\\frac{G\_{\\mathrm{POA}}}{U_0+U_1\\,v} \\\]

**In words:** the panel heats above the air in proportion to the sunlight; wind cools it. At 800 W/m², 32 °C air and 2 m/s wind: \\(T_c\\approx52\\ ^{\\circ}\\mathrm{C}\\).

(5) DC power · PVWatts\\\[ P\_{\\mathrm{dc}}=P\_{\\mathrm{STC}}\\,\\frac{G\_{\\mathrm{eff}}}{G\_{\\mathrm{STC}}}\\bigl\[1+\\gamma\\,(T_c-T\_{\\mathrm{STC}})\\bigr\] \\\]

**In words:** power grows with light and falls with heat. With \\(\\gamma=-0.35\\ \\%/^{\\circ}\\mathrm{C}\\) and \\(T_c=55\\ ^{\\circ}\\mathrm{C}\\): \\(1+\\gamma\\cdot 30=0.895\\), a 10.5 % loss (chart, top right).

(6) AC power · losses and inverter\\\[ P\_{\\mathrm{ac}}=\\min\\!\\Bigl(\\eta\_{\\mathrm{inv}}\\,(1-L\_{\\mathrm{sys}})\\,P\_{\\mathrm{dc}},\\ \\tfrac{P\_{\\mathrm{STC}}}{r}\\Bigr) \\\]

**In words:** wiring, mismatch and soiling remove \\(L\_{\\mathrm{sys}}\\) (PVWatts default 14 %); the inverter converts to AC and cannot exceed its rating, so midday peaks above it are clipped (chart, bottom right).

(7) Energy per kWp in hour h\\\[ y_h=\\frac{1}{P\_{\\mathrm{STC}}}\\int_h^{h+1}P\_{\\mathrm{ac}}\\,dt\\approx\\frac{P\_{\\mathrm{ac},h}\\cdot 1\\ \\mathrm{h}}{P\_{\\mathrm{STC}}} \\\]

**In words:** one hour of AC power per installed kWp. Summed over a year it gives \\(Y_f\\); weighted against prices it gives \\(P\_{\\mathrm{cap}}\\).

Heat factor \\(1+\\gamma\\,(T_c-25)\\) with \\(\\gamma=-0.35\\) %/°C, no unit

DC power, \\(r=1.3\\)AC deliveredInverter limit \\(1/r\\)

What our runs apply

**valor_nodo.py, NASA run.** Eq. (1)–(2) with the tracker, then a heat derate \\(1-0.0035\\,(T_c-25)\\) with a simplified \\(T_c=T_a+25\\,G\_{\\mathrm{POA}}/800\\).

**Not yet applied.** Eq. (3) and (6): reflection, soiling, wiring and inverter. Revenue slides reduce \\(Y_f\\) by 14 % instead; VF barely changes. Upgrading to ModelChain is a small change.

**\\(T_a,\\ T_c\\)** air and cell temperature, °C**\\(v\\)** wind speed, m/s**\\(U_0,\\ U_1\\)** 25 W/(m²K), 6.84 W·s/(m³K) \[5\]**\\(G\_{\\mathrm{eff}},\\ G\_{\\mathrm{STC}}\\)** effective irradiance; 1,000 W/m²**\\(\\gamma\\)** −0.30 to −0.40 %/°C for silicon**\\(L\_{\\mathrm{sys}},\\ \\eta\_{\\mathrm{inv}},\\ r\\)** system losses; inverter efficiency (96–98 %); DC/AC ratio (1.2–1.3)\[5\] Faiman, D. (2008). *Progress in Photovoltaics* 16(4), 307–315. \[6\] Dobos, A. P. (2014). PVWatts Version 5 Manual. NREL/TP-6A20-62641. Clipping chart: illustrative clear day, \\(G\_{\\mathrm{POA}}\\) peak 1,050 W/m², \\(\\eta\_{\\mathrm{inv}}(1-L\_{\\mathrm{sys}})\\) = 0.97 × 0.90.

**A4** · Appendix · From sun to kWhEquations (4)–(6) applied to one hour

Interactive · the pvlib chain for a single hour

## Where 1 kWp loses power between the sky and the meter

Set the conditions of one hour and follow the power of 1 kWp through equations (4) to (6). The top bar is what an irradiance-only calculation assumes; the bottom bar is what the meter sees.

pvlib

Sunlight on panel \\(G\_{\\mathrm{POA}}\\), W/m²

Air temperature \\(T_a\\), °C

Wind speed \\(v\\), m/s

Temperature coefficient \\(\\gamma\\), %/°C

System losses \\(L\_{\\mathrm{sys}}\\), %

Inverter efficiency \\(\\eta\_{\\mathrm{inv}}\\), %

DC/AC ratio \\(r\\)

- **Why it matters.** An irradiance-only calculation treats every kWh/m² of sunlight as output. This hour shows 20–30 % of it never reaches the meter, and the share is larger on hot sites.
- **Try it.** Raise \\(T_a\\) to 42 °C and drop wind to 0: that is a Sonora afternoon. Raise \\(G\_{\\mathrm{POA}}\\) above 1,000 with \\(r=1.3\\): clipping appears.

Cell temp. · °C

Heat factor · no unit

AC power · kW per kWp

Kept vs sunlight · %

**\\(G\_{\\mathrm{POA}}\\)** sunlight on the panel plane, W/m²**\\(T_a,\\ T_c\\)** air and cell temperature, °C; \\(T_c\\) from eq. (4)**\\(v\\)** wind speed, cools the panel**\\(\\gamma\\)** power lost per °C above 25 °C**\\(L\_{\\mathrm{sys}}\\)** wiring, mismatch, soiling, availability**\\(\\eta\_{\\mathrm{inv}},\\ r\\)** inverter efficiency; panel kWp per inverter kW“Kept vs sunlight” is the hourly performance ratio \\(P\_{\\mathrm{ac}}G\_{\\mathrm{STC}}/(P\_{\\mathrm{STC}}G\_{\\mathrm{POA}})\\). Reflection and soiling losses of eq. (3) are folded into \\(L\_{\\mathrm{sys}}\\) here.

**A5** · Appendix · The shortcut“Total Generation” vs the hourly model

Office prospection, rewritten

## The shortcut is the hourly model with four factors set to 1

“Total Generation” multiplies annual horizontal sunshine by a 2022 average price. Writing the real revenue in the same units shows which four effects it ignores and in which direction each pushes.

Total Generation (REPSA office prospection deck)\\\[ \\mathrm{TG}=\\frac{H\_{\\mathrm{GHI}}\\cdot\\overline{\\mathrm{PML}}\_{2022}}{1000}\\qquad\\text{e.g. } \\frac{2{,}220\\times40.73}{1000}=90\\ \\tfrac{\\mathrm{USD}}{\\mathrm{kWp\\cdot yr}} \\\]

Real revenue per kWp, same units\\\[ \\frac{R}{P\_{\\mathrm{STC}}}=\\mathrm{TG}\\times\\underbrace{\\mathrm{PR}}\_{\\text{losses}}\\times\\underbrace{\\frac{H\_{\\mathrm{POA}}}{H\_{\\mathrm{GHI}}}}\_{\\text{panel plane}}\\times\\underbrace{\\mathrm{VF}}\_{\\text{timing}}\\times\\underbrace{\\frac{\\overline{\\mathrm{PML}}\_{\\text{now}}}{\\overline{\\mathrm{PML}}\_{2022}}}\_{\\text{price level}} \\\]

| Factor | What the shortcut assumes | Reality | Effect on TG |
| --- | --- | --- | --- |
| PR | Every kWh/m² becomes a kWh (PR = 1) | 0.75–0.85; lower on hot sites | Overstates 15–25 % |
| \\(H\_{\\mathrm{POA}}/H\_{\\mathrm{GHI}}\\) | Panel lies flat | ≈ 1.10 fixed tilt, ≈ 1.25 tracker | Understates |
| VF | Every MWh sells at the average price | 0.58–0.86 by region (2025–26) | Overstates 17–73 % |
| Price level | 2022 forecast, in USD | Hourly CENACE PML, last 12 months | Either way |

PR

\\(H\_{\\mathrm{POA}}/H\_{\\mathrm{GHI}}\\)

VF

Price level now / 2022

Real ÷ shortcut · no unit

Shortcut error · %

Read the bars left to right: start at the shortcut (100) and apply one correction at a time. Defaults: national VF 0.79 (2025–26, NASA weather), tracker plane gain 1.25, PR 0.80.

**\\(\\mathrm{TG}\\)** Total Generation, USD per kWp per year (ranking index)**\\(H\_{\\mathrm{GHI}},\\ H\_{\\mathrm{POA}}\\)** annual irradiation, flat and on the panel, kWh/m²**\\(\\overline{\\mathrm{PML}}\_{2022}\\)** average node price from the 2022 file, USD/MWh**\\(\\mathrm{PR}\\)** performance ratio, \\(Y_f\\,G\_{\\mathrm{STC}}/H\_{\\mathrm{POA}}\\)**\\(\\mathrm{VF}\\)** value factor (slides 04–07)**\\(R/P\_{\\mathrm{STC}}\\)** real revenue per kWpRanking with real data (NASA weather, 2025–26): ranking nodes by shortcut revenue \\(Y_f\\overline{\\mathrm{PML}}\\) or by real revenue \\(Y_f P\_{\\mathrm{cap}}\\) gives almost the same national order (Spearman 0.98); inside a region it does not: in Oriental the two top-20 lists share no node (Spearman 0.87).

Editing text · press E to finish · saved in this browser only