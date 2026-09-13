# TrainOS BD — the value chain Alex sits in, with the numbers that exist

> Saved 13 Sep 2026 from the user's research session. Where a figure is arithmetic on top of published data it says so; where nobody publishes it, it says that too. Companion document: `proposal-content-pack-v2.md`. Iterate here; do not fork copies.

# 🧱 The value chain Alex sits in

```
LAYER 0  POLICY & FUNDING     Ministry of HR (KESUMA) · HRD Corp (levy, schemes, ACM, eTRIS) · AG/PAC oversight
                              MDEC / MIDA / SME Corp (grants)
        │  1% levy in, grants out
LAYER 1  DEMAND               ~90,000 registered employers · HR/L&D managers · procurement
                              Manufacturing is the biggest sector (795k training places in 2025)
        │  "use it or lose it" pressure (forfeiture, 15% deduction)
LAYER 2  INTERMEDIARIES       Directories/marketplaces · HR consultancies · HRMS vendors bundling training · brokers
        │
LAYER 3  PROVIDERS  ◄── ALEX  7,975 registered training providers, from Trainocate-scale to sole proprietors
                              Programme IP owners (licensed/vendor-certified content) sit above the delivery providers
        │  the scarce input
LAYER 4  TRAINERS             ~3,000 HRD Corp accredited trainers (3,027 in 2023) · mostly freelance · HRD-TDF gate
        │
LAYER 5  DELIVERY INPUTS      Venues, catering, materials, LMS/e-learning, assessment & certification bodies
        │
LAYER 6  COMPLIANCE & MONEY   eTRIS grant → training → claim · HRD Corp 4% service fee · accounting/MyInvois · SST
        │
LAYER 7  TOOLING              CRM, HRMS, WhatsApp, LMS, e-attendance ◄── where TrainOS lives
```

# 📊 The real numbers

**The money flow.** HRD Corp's levy collection went from RM475 million in 2020 to RM848 million in 2021, RM1.81 billion in 2022 and RM2.13 billion in 2023, with utilisation rising from 63% to 71% over the same period. In 2023, claims disbursement was RM1.52 billion against 89,912 registered employers and 2.3 million training places. Then in 2025, HRD Corp approved RM2.62 billion in financial assistance, a 32% increase on 2024, across more than 2.8 million training places — which puts 2024 at roughly RM1.98 billion by arithmetic. Assets under management rose to RM4.16 billion.

**The supply side.** eTRIS lists 7,975 registered providers; independent directories count ~3,700 verified ones. The 2023 annual report targeted 2,500 accredited trainers and reached 3,027. HRD Corp's own pitch to providers: employers can claim up to 100% of training costs, and the new Allowable Cost Matrix raised the fee ceiling to up to RM1,500/hour for premium programmes.

**The pressure that creates demand.** Levy unused for 24 months is forfeited above a RM10,000 floor, and since March 2025 employers with a balance above RM50,000 and utilisation below 50% lose 15% of the excess. One provider blog citing the 2025 annual report reports that only 47% of registered employers claimed training funds in 2025 — treat that as a secondary figure, but it's consistent with the 71% utilisation HRD Corp itself reported.

**The policy climate.** The AG and PAC reports in 2024 flagged HRD Corp for using collected levies for risky investments, and HRD Corp responded with governance reforms. That scrutiny is why Circular 2/2026 exists and why more tightening is likely — the compliance engine isn't a nice-to-have, it's a hedge against the regulator.

# 🎯 What Alex is actually trying to capture

Not "training revenue." He's trying to capture **a larger share of a RM 2.6 billion annual levy flow whose spending is forced by policy, gated by a clock, and fulfilled by a scarce trainer pool.** Three specific things:

1. **Throughput within the window.** Since June, the provider who can go from enquiry to approved grant to delivered training inside the 14–90 day corridor, without a rejected claim, wins the account. That's an operations constraint, and it's the one TrainOS removes.
2. **The "use it or lose it" cohort.** Tens of thousands of registered employers didn't claim last year; many sit above RM50k with low utilisation and are about to lose 15%. They don't need convincing to train — they need a provider who can mobilise. Directories already advise those employers to contact 3–5 providers simultaneously and pick whoever can start within 1–2 weeks. Speed *is* the sales pitch.
3. **The trainer network as a moat.** With ~3,000 accredited trainers for ~8,000 providers, the provider with the best trainer matching, availability and accreditation tracking books the good ones first. That's a data asset, not a people asset.

The average provider's slice is small and skewed — RM2.62b across 7,975 providers is ~RM330k each by arithmetic, but a handful of vendor-certified shops (one lists USD 35m revenue) take a disproportionate share. Alex's realistic ambition is to move from the long tail toward the professionalised middle, and the way you do that is fulfilment capacity, not marketing.

# 🧭 How to angle it

**Sell "claim-window fulfilment," not "AI operations."** The RFP language is agentic; the buying reason is: *no lost claims, faster mobilisation, more engagements per admin.* Every demo screen should reinforce one of those three.

**Build the levy radar.** Employer balances aren't public, but a client's levy balance, contribution rate and claim history are known to the provider that serves them. TrainOS tracks utilisation per client and flags "likely below 50% by December → at risk of 15% deduction → pitch now." That's Alex's cross-sell engine and it's data nobody else in his chain is assembling.

**Position against the intermediaries.** Directories and brokers are monetising the demand side by sending employers to five providers at once. A provider with TrainOS answers first, with a claimable date and a packet already scoped. That turns the broker's commoditisation into Alex's advantage.

**Price against the levy, not against his P&L.** A RM 150k build is roughly one mid-sized in-house programme a month in extra throughput at ACM ceilings (a 2-day, 20-pax in-house claim runs up to RM 12,000, RM 11,520 after the 4% fee). Frame the payback in engagements, not in admin savings alone.

# 📐 How big this is, with the method shown

| Question | Number | Basis |
|---|---|---|
| Levy-funded training flowing to the ecosystem per year | **RM 2.62b (2025)** | HRD Corp published; includes course fees, allowances, meals, venue — HRD Corp does not publish the provider-fee share |
| Growth | **+32% 2024→2025; ~5.5× since 2020** | Published series |
| Demand side | **~90,000 employers** | Published |
| Supply side | **7,975 registered providers, ~3,000 accredited trainers** | Published |
| Unclaimed money in the system | **Order of RM 600m+/year** | Arithmetic: ~29% unutilised on ~RM2.1b+ collected; not a published figure |
| Alex's serviceable slice | **Unknown — needs his numbers** | Engagements/year × average value; TrainOS's lever is engagements per admin FTE, not price |
| TrainOS as a product across providers | **Ceiling ~RM 5–15m ARR** | Arithmetic: if ~10% of providers (≈800) are professionalised enough to pay RM 500–1,500/month; the 10% is an assumption, not data |

What we don't know and shouldn't pretend to: the total corporate-training market beyond levy funding (non-registered employers, premium non-claimable programmes, vendor certifications) — no credible Malaysian source publishes it, and the SEO reports that do are not worth citing in front of a finance person. The levy-funded core is the number you can defend.

# ⚠️ Two truths to say out loud

The provider layer is **policy-dependent**: levy exemptions (the education sector got a full-year exemption in 2026) and rule changes move demand overnight. That's a risk for Alex and the reason a rules registry is worth paying for.

And the long tail is real. Most of the 7,975 providers will never buy software. Your second and third clients are the few hundred who already have a sales team, an ops person, and a finance person arguing about a RM 150k quote — exactly the room Alex is about to walk into.
